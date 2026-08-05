import { expect } from "chai";
import { ethers, upgrades } from "hardhat";
import { time } from "@nomicfoundation/hardhat-network-helpers";

const ONE = 10n ** 18n;
const GROWTH_PER_TICK = 1011619440000000000n;
const TICK_MS = 100n;
const MAX_TICKS = 1200n;
const INSTANT_RUG_DIVISOR = 101n;

/** The reference implementation the frontend also ships — see lib/games/crash/fairness.ts. */
const pow = (base: bigint, exponent: bigint): bigint => {
  let result = ONE;
  let b = base;
  let e = exponent;

  while (e > 0n) {
    if (e & 1n) {
      result = (result * b) / ONE;
    }

    e >>= 1n;

    if (e > 0n) {
      b = (b * b) / ONE;
    }
  }

  return result;
};

const multiplierAt = (elapsedMs: bigint): bigint => {
  let ticks = elapsedMs / TICK_MS;

  if (ticks > MAX_TICKS) {
    ticks = MAX_TICKS;
  }

  return pow(GROWTH_PER_TICK, ticks);
};

const rugMultiplier = (serverSeed: string, clientSeed: string, nonce: bigint): bigint => {
  const packed = ethers.solidityPacked(
    ["bytes32", "string", "uint256"],
    [serverSeed, clientSeed, nonce],
  );
  const hash = BigInt(ethers.keccak256(packed));

  if (hash % INSTANT_RUG_DIVISOR === 0n) {
    return ONE;
  }

  const e = 1n << 52n;
  const h = hash >> 204n;

  return ((100n * e - h) / (e - h)) * 10n ** 16n;
};

const deploy = async () => {
  const [owner, alice, bob] = await ethers.getSigners();
  const RugRush = await ethers.getContractFactory("RugRush");
  const rugRush = await upgrades.deployProxy(RugRush, [owner.address], {
    kind: "uups",
    initializer: "initialize",
  });
  await rugRush.waitForDeployment();
  await rugRush.fundBankroll({ value: ethers.parseEther("500") });

  return { rugRush, owner, alice, bob };
};

/** Commit a seed chosen so the round rugs above `minimum`. */
const seedRuggingAbove = (clientSeed: string, nonce: bigint, minimum: number): string => {
  for (let index = 0; index < 20_000; index++) {
    const seed = ethers.zeroPadValue(ethers.toBeHex(index + 1), 32);

    if (rugMultiplier(seed, clientSeed, nonce) >= BigInt(Math.round(minimum * 100)) * 10n ** 16n) {
      return seed;
    }
  }

  throw new Error(`No seed found rugging above ${minimum}`);
};

describe("RugRush", () => {
  describe("curve", () => {
    it("matches the reference implementation the client uses", async () => {
      const { rugRush } = await deploy();

      for (const elapsed of [0n, 50n, 100n, 600n, 6_000n, 30_000n, 120_000n, 999_999n]) {
        expect(await rugRush.multiplierAt(elapsed)).to.equal(
          multiplierAt(elapsed),
          `mismatch at ${elapsed}ms`,
        );
      }
    });

    it("doubles roughly every six seconds", async () => {
      const { rugRush } = await deploy();
      const at6s = await rugRush.multiplierAt(6_000);

      // 2^(1/60) per 100ms tick, 60 ticks in 6s.
      expect(Number(at6s) / 1e18).to.be.closeTo(2, 0.001);
    });

    it("is clamped at the tick ceiling", async () => {
      const { rugRush } = await deploy();

      expect(await rugRush.multiplierAt(120_000)).to.equal(
        await rugRush.multiplierAt(10_000_000),
      );
    });
  });

  describe("rug derivation", () => {
    it("matches the reference implementation", async () => {
      const { rugRush } = await deploy();

      for (let nonce = 0n; nonce < 25n; nonce++) {
        const seed = ethers.zeroPadValue(ethers.toBeHex(nonce + 1n), 32);
        expect(await rugRush.rugMultiplier(seed, "client", nonce)).to.equal(
          rugMultiplier(seed, "client", nonce),
          `mismatch at nonce ${nonce}`,
        );
      }
    });

    it("never rugs below 1.00x", async () => {
      const { rugRush } = await deploy();

      for (let nonce = 0n; nonce < 50n; nonce++) {
        const seed = ethers.zeroPadValue(ethers.toBeHex(nonce + 7n), 32);
        expect(await rugRush.rugMultiplier(seed, "c", nonce)).to.be.gte(ONE);
      }
    });
  });

  describe("round lifecycle", () => {
    it("pays a player who sold below the rug", async () => {
      const { rugRush, alice } = await deploy();
      const clientSeed = "seed-a";
      const roundId = 0n;
      // Needs to survive past the sell, which lands a few seconds in.
      const serverSeed = seedRuggingAbove(clientSeed, roundId, 50);

      await rugRush.commitRound(ethers.keccak256(serverSeed), clientSeed);
      await rugRush.connect(alice).buyIn(roundId, 0, { value: ethers.parseEther("1") });
      await rugRush.startRound(roundId);

      await time.increase(3);
      await rugRush.connect(alice).sell(roundId);

      const position = await rugRush.getPosition(roundId, alice.address);
      expect(position.soldAtX18).to.be.gt(ONE);

      await rugRush.revealRound(roundId, serverSeed);

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await rugRush.connect(alice).settle(roundId);
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(alice.address);

      const expected = (ethers.parseEther("1") * position.soldAtX18) / ONE;
      expect(after - before + gas).to.equal(expected);
    });

    it("pays nothing to a player still holding at the rug", async () => {
      const { rugRush, alice } = await deploy();
      const clientSeed = "seed-b";
      const roundId = 0n;
      const serverSeed = seedRuggingAbove(clientSeed, roundId, 1.0);

      await rugRush.commitRound(ethers.keccak256(serverSeed), clientSeed);
      // Auto-sell far above where this round rugs.
      await rugRush.connect(alice).buyIn(roundId, ethers.parseEther("100000"), {
        value: ethers.parseEther("1"),
      });
      await rugRush.startRound(roundId);
      await rugRush.revealRound(roundId, serverSeed);

      await expect(rugRush.connect(alice).settle(roundId))
        .to.emit(rugRush, "Settled")
        .withArgs(roundId, alice.address, 0, false);
    });

    it("honours an auto-sell that the rug reached", async () => {
      const { rugRush, alice } = await deploy();
      const clientSeed = "seed-c";
      const roundId = 0n;
      const serverSeed = seedRuggingAbove(clientSeed, roundId, 5);
      const target = ethers.parseEther("2");

      await rugRush.commitRound(ethers.keccak256(serverSeed), clientSeed);
      await rugRush.connect(alice).buyIn(roundId, target, { value: ethers.parseEther("1") });
      await rugRush.startRound(roundId);
      await rugRush.revealRound(roundId, serverSeed);

      await expect(rugRush.connect(alice).settle(roundId))
        .to.emit(rugRush, "Settled")
        .withArgs(roundId, alice.address, ethers.parseEther("2"), true);
    });

    it("rejects a reveal that does not match the commit", async () => {
      const { rugRush } = await deploy();

      await rugRush.commitRound(ethers.keccak256(ethers.zeroPadValue("0x01", 32)), "c");
      await rugRush.startRound(0);

      await expect(
        rugRush.revealRound(0, ethers.zeroPadValue("0x02", 32)),
      ).to.be.revertedWith("Seed mismatch");
    });

    it("refuses bets once the curve has started", async () => {
      const { rugRush, alice } = await deploy();

      await rugRush.commitRound(ethers.keccak256(ethers.zeroPadValue("0x03", 32)), "c");
      await rugRush.startRound(0);

      await expect(
        rugRush.connect(alice).buyIn(0, 0, { value: ethers.parseEther("1") }),
      ).to.be.revertedWith("Betting closed");
    });
  });

  describe("operator failure", () => {
    it("lets anyone void a round the operator never revealed, and refunds in full", async () => {
      const { rugRush, alice, bob } = await deploy();
      const stake = ethers.parseEther("2");

      await rugRush.commitRound(ethers.keccak256(ethers.zeroPadValue("0x04", 32)), "c");
      await rugRush.connect(alice).buyIn(0, 0, { value: stake });
      await rugRush.startRound(0);

      await expect(rugRush.connect(bob).voidRound(0)).to.be.revertedWith(
        "Reveal window still open",
      );

      await time.increase(16 * 60);
      await rugRush.connect(bob).voidRound(0);

      const before = await ethers.provider.getBalance(alice.address);
      const tx = await rugRush.connect(alice).settle(0);
      const receipt = await tx.wait();
      const gas = receipt!.gasUsed * receipt!.gasPrice;
      const after = await ethers.provider.getBalance(alice.address);

      expect(after - before + gas).to.equal(stake);
    });
  });

  describe("bankroll", () => {
    it("rejects a stake the bankroll cannot cover", async () => {
      const [owner, alice] = await ethers.getSigners();
      const RugRush = await ethers.getContractFactory("RugRush");
      const rugRush = await upgrades.deployProxy(RugRush, [owner.address], {
        kind: "uups",
        initializer: "initialize",
      });
      await rugRush.waitForDeployment();
      await rugRush.fundBankroll({ value: ethers.parseEther("1") });

      await rugRush.commitRound(ethers.keccak256(ethers.zeroPadValue("0x05", 32)), "c");

      // The live ceiling is min(maxPayout, 20% of bankroll) = 0.2 ETH, which cannot even
      // return a 1 ETH stake, so the table refuses the bet.
      await expect(
        rugRush.connect(alice).buyIn(0, ethers.parseEther("10"), {
          value: ethers.parseEther("1"),
        }),
      ).to.be.revertedWith("Stake exceeds table limit");
    });
  });
});
