// The twist: every RugRush round is a freshly "launched" token.
//
// The token's identity — name, ticker, supply, the little launch events that scroll past
// the chart — is derived from the round's PUBLIC commit hash, so it can be shown before
// betting opens without leaking anything.
//
// That separation matters and is not cosmetic bookkeeping: the rug multiplier comes from
// the secret `serverSeed`, which cannot be derived from its own hash. So none of the
// flavour below carries information about when the rug lands. A token with "LP LOCKED" is
// no safer than one with "DEV WALLET 40%" — the badges are theatre, and the UI says so.

import { keccak256, toHex } from "viem";

export type LaunchEvent = {
  /** Multiplier at which the event shows up on the chart. */
  at: number;
  label: string;
  tone: "good" | "bad" | "neutral";
};

export type TokenIdentity = {
  name: string;
  ticker: string;
  emoji: string;
  /** Total supply, purely for flavour on the token card. */
  supply: string;
  /** Starting "market cap" the curve multiplies from. */
  openMarketCap: number;
  /** Cosmetic badges. They do not predict the rug. */
  badges: string[];
  events: LaunchEvent[];
  /** Tailwind-friendly accent for the chart line. */
  accent: string;
};

const PREFIXES = [
  "Baby", "Turbo", "Mega", "Hyper", "Based", "Giga", "Quantum", "Cosmic", "Feral",
  "Degen", "Alpha", "Nano", "Ultra", "Astro", "Rogue", "Solar", "Phantom", "Atomic",
];

const NOUNS = [
  "Doge", "Pepe", "Wojak", "Chad", "Inu", "Cat", "Frog", "Ape", "Bonk", "Moon",
  "Rocket", "Diamond", "Banana", "Pixel", "Goblin", "Wizard", "Samurai", "Panda",
  "Tiger", "Falcon", "Kraken", "Sloth", "Llama", "Yeti",
];

const SUFFIXES = [
  "Coin", "Token", "Cash", "Finance", "Protocol", "Network", "DAO", "Swap", "X", "2.0",
];

const EMOJI = [
  "🐸", "🐕", "🚀", "💎", "🍌", "🦍", "🐱", "🌙", "⚡", "🔥", "👑", "🦄", "🐧", "🍄",
  "🛸", "🧿", "🦈", "🐲",
];

const ACCENTS = [
  "#f97316", "#22c55e", "#38bdf8", "#a855f7", "#f43f5e", "#eab308", "#14b8a6", "#ec4899",
];

const GOOD_EVENTS = [
  "LP locked",
  "Whale bought",
  "Listed on a tracker",
  "Trending #1",
  "Contract renounced",
  "Influencer posted",
];

const BAD_EVENTS = [
  "Dev wallet moved",
  "Large holder sold",
  "Liquidity thinning",
  "Bundled wallets spotted",
  "Sell tax raised",
];

const NEUTRAL_EVENTS = ["New holder milestone", "Volume spike", "Chart posted"];

const BADGES = [
  "LP LOCKED",
  "RENOUNCED",
  "DEV HOLDS 12%",
  "BUNDLED",
  "FRESH MINT",
  "NO TAX",
  "TAX 5/5",
  "HONEYPOT CHECKED",
];

/**
 * A deterministic byte stream from a seed. Rehashes as it runs out, so a caller can draw
 * as many values as it needs and always get the same ones back for the same seed.
 */
class SeedStream {
  private buffer: Uint8Array;
  private offset = 0;
  private counter = 0;

  constructor(private readonly seed: string) {
    this.buffer = this.nextBlock();
  }

  private nextBlock(): Uint8Array {
    const digest = keccak256(toHex(`${this.seed}:${this.counter++}`));
    const bytes = new Uint8Array(32);

    for (let index = 0; index < 32; index++) {
      bytes[index] = parseInt(digest.slice(2 + index * 2, 4 + index * 2), 16);
    }

    return bytes;
  }

  byte(): number {
    if (this.offset >= this.buffer.length) {
      this.buffer = this.nextBlock();
      this.offset = 0;
    }

    return this.buffer[this.offset++];
  }

  /** Uniform integer in [0, max). */
  int(max: number): number {
    // Two bytes is plenty for the small ranges here and keeps the modulo bias negligible.
    return ((this.byte() << 8) | this.byte()) % max;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)];
  }

  float(): number {
    return ((this.byte() << 8) | this.byte()) / 65536;
  }
};

const shortTicker = (name: string): string => {
  const letters = name.replace(/[^A-Za-z0-9]/g, "").toUpperCase();

  return letters.slice(0, Math.min(5, Math.max(3, letters.length)));
};

/**
 * Build the round's token from its public commit.
 *
 * @param serverSeedHash the hash the operator published before betting opened
 * @param clientSeed     the public client seed for the round
 * @param nonce          the round number
 */
export const generateToken = (
  serverSeedHash: string,
  clientSeed: string,
  nonce: number | bigint,
): TokenIdentity => {
  const stream = new SeedStream(`${serverSeedHash}:${clientSeed}:${nonce}`);

  const shape = stream.int(3);
  const noun = stream.pick(NOUNS);
  const name =
    shape === 0
      ? `${stream.pick(PREFIXES)} ${noun}`
      : shape === 1
        ? `${noun} ${stream.pick(SUFFIXES)}`
        : `${stream.pick(PREFIXES)} ${noun} ${stream.pick(SUFFIXES)}`;

  const supplyExponent = 6 + stream.int(6); // 1e6 .. 1e11
  const supplyMantissa = 1 + stream.int(9);

  const badgeCount = 1 + stream.int(3);
  const badges: string[] = [];

  while (badges.length < badgeCount) {
    const badge = stream.pick(BADGES);

    if (!badges.includes(badge)) {
      badges.push(badge);
    }
  }

  // Events are spread across the early part of the curve where players actually watch.
  const eventCount = 3 + stream.int(4);
  const events: LaunchEvent[] = [];

  for (let index = 0; index < eventCount; index++) {
    const tone = stream.int(10);
    const pool = tone < 4 ? GOOD_EVENTS : tone < 8 ? BAD_EVENTS : NEUTRAL_EVENTS;

    events.push({
      at: 1.15 + stream.float() * 6,
      label: stream.pick(pool),
      tone: tone < 4 ? "good" : tone < 8 ? "bad" : "neutral",
    });
  }

  events.sort((a, b) => a.at - b.at);

  return {
    name,
    ticker: `$${shortTicker(name)}`,
    emoji: stream.pick(EMOJI),
    supply: `${supplyMantissa}${"0".repeat(supplyExponent)}`,
    openMarketCap: 4_000 + stream.int(46_000),
    badges,
    events,
    accent: stream.pick(ACCENTS),
  };
};

/** Market cap implied by the current multiplier — what the chart's y-axis reads. */
export const marketCapAt = (token: TokenIdentity, multiplier: number): number =>
  token.openMarketCap * multiplier;

export const formatMarketCap = (value: number): string => {
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }

  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }

  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(1)}K`;
  }

  return `$${value.toFixed(0)}`;
};
