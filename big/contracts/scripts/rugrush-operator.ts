import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

import { deploymentDir, networkName } from "./networks";

/**
 * RugRush round operator.
 *
 * The contract cannot drive itself — someone has to commit a seed, start the curve, and
 * reveal. This loop does that. It is deliberately dumb and stateless apart from one file:
 * the seed store, which is the only secret involved.
 *
 * ## The seed store
 *
 * `rugrush-seeds.json` holds the plaintext server seed for every round that has not been
 * revealed yet. If it is lost before a reveal, those rounds cannot be settled — they will
 * be voided by anyone after the reveal window and every stake refunded, which is the
 * designed failure mode, but it still means the house neither wins nor loses those rounds.
 *
 * Treat the file as a secret. It is gitignored. In production, put it in a KMS or an HSM
 * rather than on the operator's disk.
 */

type SeedRecord = { roundId: string; serverSeed: string; clientSeed: string };

const SEED_FILE = path.join(deploymentDir(), "rugrush-seeds.json");

/** How long betting stays open before the curve starts. */
const BETTING_MS = Number(process.env.RUGRUSH_BETTING_MS ?? 15_000);
/** How long the curve is allowed to run before the reveal. */
const RUN_MS = Number(process.env.RUGRUSH_RUN_MS ?? 30_000);
/** Pause between rounds. */
const INTERMISSION_MS = Number(process.env.RUGRUSH_INTERMISSION_MS ?? 8_000);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const loadSeeds = (): SeedRecord[] => {
  if (!fs.existsSync(SEED_FILE)) {
    return [];
  }

  return JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) as SeedRecord[];
};

const saveSeeds = (seeds: SeedRecord[]) => {
  fs.mkdirSync(path.dirname(SEED_FILE), { recursive: true });
  fs.writeFileSync(SEED_FILE, JSON.stringify(seeds, null, 2), { mode: 0o600 });
};

async function main() {
  const network = await ethers.provider.getNetwork();
  const name = networkName(network.chainId);
  const file = path.join(deploymentDir(), `rugrush.${name}.json`);

  if (!fs.existsSync(file)) {
    throw new Error(`No RugRush deployment for ${name}. Run scripts/deploy-rugrush.ts first.`);
  }

  const { proxyAddress } = JSON.parse(fs.readFileSync(file, "utf8")) as { proxyAddress: string };
  const rugRush = await ethers.getContractAt("RugRush", proxyAddress);
  const [operator] = await ethers.getSigners();

  console.log("RugRush operator running against", proxyAddress);
  console.log("Operator:", operator.address);
  console.log(
    `Cadence: ${BETTING_MS / 1000}s betting, ${RUN_MS / 1000}s run, ${INTERMISSION_MS / 1000}s break`,
  );
  console.log("Ctrl-C to stop. Any round left unrevealed can be voided by anyone.\n");

  // Reveal anything left hanging from a previous run before opening a new round.
  for (const record of loadSeeds()) {
    const round = await rugRush.getRound(record.roundId);

    // state 2 == Running
    if (Number(round.state) === 2) {
      console.log(`Revealing orphaned round #${record.roundId}…`);
      await (await rugRush.revealRound(record.roundId, record.serverSeed)).wait();
    }
  }

  for (;;) {
    const serverSeed = ethers.hexlify(ethers.randomBytes(32));
    const serverSeedHash = ethers.keccak256(serverSeed);
    // A public client seed anyone can check. Deriving it from the previous block hash
    // means the operator does not choose it alone.
    const block = await ethers.provider.getBlock("latest");
    const clientSeed = block?.hash ?? Date.now().toString(16);

    const commitTx = await rugRush.commitRound(serverSeedHash, clientSeed);
    await commitTx.wait();

    const roundId = (await rugRush.roundCount()) - 1n;
    console.log(`Round #${roundId} committed. Betting open for ${BETTING_MS / 1000}s.`);

    saveSeeds([
      ...loadSeeds(),
      { roundId: roundId.toString(), serverSeed, clientSeed },
    ]);

    await sleep(BETTING_MS);

    await (await rugRush.startRound(roundId)).wait();
    console.log(`Round #${roundId} launched.`);

    await sleep(RUN_MS);

    await (await rugRush.revealRound(roundId, serverSeed)).wait();
    const settled = await rugRush.getRound(roundId);
    console.log(
      `Round #${roundId} rugged at ${(Number(settled.rugX18) / 1e18).toFixed(2)}× ` +
        `(staked ${ethers.formatEther(settled.totalStaked)}).\n`,
    );

    // The seed is public now; drop it from the store.
    saveSeeds(loadSeeds().filter((record) => record.roundId !== roundId.toString()));

    await sleep(INTERMISSION_MS);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
