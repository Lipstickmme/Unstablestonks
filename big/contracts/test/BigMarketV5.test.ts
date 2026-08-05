import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const HOUR = 3600;

const deploy = async () => {
  const [owner, alice, bob, carol, creator] = await ethers.getSigners();
  const BigMarketV5 = await ethers.getContractFactory("BigMarketV5");
  const market = await upgrades.deployProxy(BigMarketV5, [owner.address], {
    kind: "uups",
    initializer: "initialize",
  });
  await market.waitForDeployment();
  await market.authorizeCreator(creator.address);

  return { market, owner, alice, bob, carol, creator };
};

/**
 * `getEvent` collides with ethers' own `Contract.getEvent(name)`, so the contract's
 * getter has to be reached explicitly. The frontend uses viem and is unaffected.
 */
const getEventData = (market: any, eventId: bigint) =>
  market.getFunction("getEvent")(eventId);

const createEvent = async (
  market: any,
  creator: any,
  outcomes = ["Yes", "No"],
  endInSeconds = 2 * HOUR,
) => {
  const endTime = (await time.latest()) + endInSeconds;
  await market
    .connect(creator)
    .createEvent("Will it?", "Politics", "0x", "context", endTime, outcomes);

  return { eventId: (await market.eventCount()) - 1n, endTime };
};

describe("BigMarketV5", () => {
  describe("resolution with a dispute window", () => {
    it("does not pay out until the window closes", async () => {
      const { market, alice, creator } = await deploy();
      const { eventId, endTime } = await createEvent(market, creator);

      await market.connect(alice).placeBet(eventId, 0, { value: ethers.parseEther("1") });
      await time.increaseTo(endTime + 1);

      await market.proposeResolution(eventId, 0);

      await expect(market.connect(alice).claimPayout(eventId)).to.be.revertedWith(
        "Event not settled",
      );

      await expect(market.finalizeResolution(eventId)).to.be.revertedWith(
        "Dispute window still open",
      );

      await time.increase(6 * HOUR);
      await market.finalizeResolution(eventId);

      await expect(market.connect(alice).claimPayout(eventId)).to.emit(market, "PayoutClaimed");
    });

    it("returns the bond when a challenger is proved right", async () => {
      const { market, alice, bob, creator } = await deploy();
      const { eventId, endTime } = await createEvent(market, creator);

      await market.connect(alice).placeBet(eventId, 0, { value: ethers.parseEther("1") });
      await market.connect(bob).placeBet(eventId, 1, { value: ethers.parseEther("1") });
      await time.increaseTo(endTime + 1);

      await market.proposeResolution(eventId, 0);

      const bond = await market.disputeBond();
      await market.connect(bob).disputeResolution(eventId, { value: bond });

      const before = await ethers.provider.getBalance(bob.address);
      // The owner rules for the challenger: outcome 1 actually won.
      await market.settleDispute(eventId, 1);
      const after = await ethers.provider.getBalance(bob.address);

      expect(after - before).to.equal(bond);

      const eventData = await getEventData(market, eventId);
      expect(eventData.resolved).to.equal(true);
      expect(eventData.winningOutcome).to.equal(1n);
    });

    it("forfeits the bond when a challenge fails", async () => {
      const { market, alice, bob, creator } = await deploy();
      const { eventId, endTime } = await createEvent(market, creator);

      await market.connect(alice).placeBet(eventId, 0, { value: ethers.parseEther("1") });
      await time.increaseTo(endTime + 1);
      await market.proposeResolution(eventId, 0);

      const bond = await market.disputeBond();
      const feesBefore = await market.totalPlatformFees();
      await market.connect(bob).disputeResolution(eventId, { value: bond });

      const before = await ethers.provider.getBalance(bob.address);
      await market.settleDispute(eventId, 0);
      const after = await ethers.provider.getBalance(bob.address);

      expect(after).to.equal(before);
      expect(await market.totalPlatformFees()).to.equal(feesBefore + bond);
    });
  });

  describe("stranded pools", () => {
    it("refunds everyone when nobody backed the winning outcome", async () => {
      const { market, alice, bob, creator } = await deploy();
      const { eventId, endTime } = await createEvent(market, creator, ["A", "B", "C"]);

      // Both bettors are on A and B; C wins.
      await market.connect(alice).placeBet(eventId, 0, { value: ethers.parseEther("1") });
      await market.connect(bob).placeBet(eventId, 1, { value: ethers.parseEther("2") });
      await time.increaseTo(endTime + 1);

      await market.proposeResolution(eventId, 2);
      await time.increase(6 * HOUR);

      await expect(market.finalizeResolution(eventId)).to.emit(market, "EventCancelled");

      expect(await market.cancelled(eventId)).to.equal(true);

      // Every stake comes back, net of the platform fee taken on the way in.
      const netAlice = (ethers.parseEther("1") * 9800n) / 10000n;
      const before = await ethers.provider.getBalance(alice.address);
      const tx = await market.connect(alice).claimRefund(eventId);
      const receipt = await tx.wait();
      const after = await ethers.provider.getBalance(alice.address);

      expect(after - before + receipt!.gasUsed * receipt!.gasPrice).to.equal(netAlice);
    });

    it("refunds a cancelled event", async () => {
      const { market, alice, creator } = await deploy();
      const { eventId } = await createEvent(market, creator);

      await market.connect(alice).placeBet(eventId, 0, { value: ethers.parseEther("1") });
      await market.cancelEvent(eventId, "Match abandoned");

      await expect(market.connect(alice).claimRefund(eventId)).to.emit(market, "RefundClaimed");
      await expect(market.connect(alice).claimRefund(eventId)).to.be.revertedWith(
        "Already claimed",
      );
    });
  });

  describe("early exit", () => {
    it("returns the stake minus the exit fee", async () => {
      const { market, alice, creator } = await deploy();
      const { eventId } = await createEvent(market, creator);

      await market.connect(alice).placeBet(eventId, 0, { value: ethers.parseEther("1") });

      const staked = await market.getUserBet(eventId, alice.address, 0);
      const exitFeeBps = await market.exitFeeBps();
      const fee = (staked * exitFeeBps) / 10000n;

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await market.connect(alice).sellPosition(eventId, 0, staked);
      const receipt = await tx.wait();
      const after = await ethers.provider.getBalance(alice.address);

      expect(after - before + receipt!.gasUsed * receipt!.gasPrice).to.equal(staked - fee);
      expect(await market.getUserBet(eventId, alice.address, 0)).to.equal(0n);

      const eventData = await getEventData(market, eventId);
      expect(eventData.totalPool).to.equal(0n);
    });

    it("closes exits near the end time", async () => {
      const { market, alice, creator } = await deploy();
      const { eventId, endTime } = await createEvent(market, creator);

      await market.connect(alice).placeBet(eventId, 0, { value: ethers.parseEther("1") });
      const staked = await market.getUserBet(eventId, alice.address, 0);

      await time.increaseTo(endTime - 60);

      await expect(
        market.connect(alice).sellPosition(eventId, 0, staked),
      ).to.be.revertedWith("Exits are closed");
    });
  });

  describe("creator fees", () => {
    it("pays the creator a share of the platform fee", async () => {
      const { market, alice, creator } = await deploy();
      const { eventId } = await createEvent(market, creator);

      const stake = ethers.parseEther("10");
      await market.connect(alice).placeBet(eventId, 0, { value: stake });

      const platformFee = (stake * 200n) / 10000n;
      const share = await market.creatorFeeShareBps();
      const expected = (platformFee * share) / 10000n;

      expect(await market.creatorFees(creator.address)).to.equal(expected);
      expect(await market.totalPlatformFees()).to.equal(platformFee - expected);

      const before = await ethers.provider.getBalance(creator.address);
      const tx = await market.connect(creator).withdrawCreatorFees();
      const receipt = await tx.wait();
      const after = await ethers.provider.getBalance(creator.address);

      expect(after - before + receipt!.gasUsed * receipt!.gasPrice).to.equal(expected);
    });

    it("does not take the creator share out of the bettor's stake", async () => {
      const { market, alice, creator } = await deploy();
      const { eventId } = await createEvent(market, creator);

      const stake = ethers.parseEther("10");
      await market.connect(alice).placeBet(eventId, 0, { value: stake });

      // The pool still receives 98% — the creator's cut comes out of the 2% fee.
      expect(await market.getUserBet(eventId, alice.address, 0)).to.equal(
        (stake * 9800n) / 10000n,
      );
    });
  });

  describe("payouts", () => {
    it("splits the pool proportionally among winners", async () => {
      const { market, alice, bob, carol, creator } = await deploy();
      const { eventId, endTime } = await createEvent(market, creator);

      await market.connect(alice).placeBet(eventId, 0, { value: ethers.parseEther("1") });
      await market.connect(bob).placeBet(eventId, 0, { value: ethers.parseEther("3") });
      await market.connect(carol).placeBet(eventId, 1, { value: ethers.parseEther("4") });

      await time.increaseTo(endTime + 1);
      await market.proposeResolution(eventId, 0);
      await time.increase(6 * HOUR);
      await market.finalizeResolution(eventId);

      const eventData = await getEventData(market, eventId);
      const aliceBet = await market.getUserBet(eventId, alice.address, 0);
      const winningPool = eventData.pools[0];
      const expected = (eventData.totalPool * aliceBet) / winningPool;

      expect(await market.previewPayout(eventId, alice.address)).to.equal(expected);

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await market.connect(alice).claimPayout(eventId);
      const receipt = await tx.wait();
      const after = await ethers.provider.getBalance(alice.address);

      expect(after - before + receipt!.gasUsed * receipt!.gasPrice).to.equal(expected);
    });

    it("claims several events at once and skips the unclaimable", async () => {
      const { market, alice, creator } = await deploy();
      const first = await createEvent(market, creator);
      const second = await createEvent(market, creator);

      await market.connect(alice).placeBet(first.eventId, 0, { value: ethers.parseEther("1") });
      await market.connect(alice).placeBet(second.eventId, 0, { value: ethers.parseEther("1") });

      await time.increaseTo(Math.max(first.endTime, second.endTime) + 1);

      for (const id of [first.eventId, second.eventId]) {
        await market.proposeResolution(id, 0);
      }

      await time.increase(6 * HOUR);

      for (const id of [first.eventId, second.eventId]) {
        await market.finalizeResolution(id);
      }

      await market.connect(alice).claimPayout(first.eventId);

      // The batch should not revert on the already-claimed leg.
      await expect(
        market.connect(alice).claimPayoutBatch([first.eventId, second.eventId]),
      ).to.emit(market, "PayoutClaimed");

      expect(await market.claimed(second.eventId, alice.address)).to.equal(true);
    });
  });

  describe("betting guards", () => {
    it("refuses bets once a result has been proposed", async () => {
      const { market, alice, bob, creator } = await deploy();
      const { eventId, endTime } = await createEvent(market, creator);

      await market.connect(alice).placeBet(eventId, 0, { value: ethers.parseEther("1") });
      await time.increaseTo(endTime + 1);
      await market.proposeResolution(eventId, 0);

      await expect(
        market.connect(bob).placeBet(eventId, 1, { value: ethers.parseEther("1") }),
      ).to.be.revertedWith("Event has ended");
    });

    it("only lets a resolver propose", async () => {
      const { market, alice, creator } = await deploy();
      const { eventId, endTime } = await createEvent(market, creator);

      await market.connect(alice).placeBet(eventId, 0, { value: ethers.parseEther("1") });
      await time.increaseTo(endTime + 1);

      await expect(market.connect(alice).proposeResolution(eventId, 0)).to.be.revertedWith(
        "Not a resolver",
      );

      await market.setResolver(alice.address, true);
      await expect(market.connect(alice).proposeResolution(eventId, 0)).to.emit(
        market,
        "ResolutionProposed",
      );
    });
  });
});
