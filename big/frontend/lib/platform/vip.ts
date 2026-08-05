// VIP tiers and rakeback.
//
// The retention machinery every large book runs: wagering earns progress, progress earns
// a tier, and a tier pays back a slice of the house edge you generated. BigMarketV4
// already tracks per-user volume and points on-chain, so this reads off that rather than
// inventing a parallel ledger.
//
// The numbers below are a starting configuration, not a law of nature — an operator
// should tune `RAKEBACK_BPS` against their actual margin before switching it on.

export type VipTier = {
  level: number;
  name: string;
  /** Cumulative wagered volume, in bet-token units, to reach this tier. */
  threshold: number;
  /** Share of house edge returned, in basis points. */
  rakebackBps: number;
  /** Monthly bonus as a share of the previous month's wagering, in basis points. */
  monthlyBonusBps: number;
  perks: string[];
  accent: string;
};

export const VIP_TIERS: readonly VipTier[] = [
  {
    level: 0,
    name: "Rookie",
    threshold: 0,
    rakebackBps: 0,
    monthlyBonusBps: 0,
    perks: ["Full sportsbook access", "Provably fair games"],
    accent: "#94a3b8",
  },
  {
    level: 1,
    name: "Bronze",
    threshold: 1_000,
    rakebackBps: 100,
    monthlyBonusBps: 0,
    perks: ["1% rakeback", "Weekly freebet drop"],
    accent: "#b45309",
  },
  {
    level: 2,
    name: "Silver",
    threshold: 10_000,
    rakebackBps: 200,
    monthlyBonusBps: 5,
    perks: ["2% rakeback", "Monthly bonus", "Higher table limits"],
    accent: "#94a3b8",
  },
  {
    level: 3,
    name: "Gold",
    threshold: 50_000,
    rakebackBps: 350,
    monthlyBonusBps: 10,
    perks: ["3.5% rakeback", "Priority cashout", "Dedicated support"],
    accent: "#eab308",
  },
  {
    level: 4,
    name: "Platinum",
    threshold: 250_000,
    rakebackBps: 500,
    monthlyBonusBps: 15,
    perks: ["5% rakeback", "Custom limits", "Early access to new markets"],
    accent: "#38bdf8",
  },
  {
    level: 5,
    name: "Diamond",
    threshold: 1_000_000,
    rakebackBps: 700,
    monthlyBonusBps: 25,
    perks: ["7% rakeback", "Negotiated odds", "Account manager"],
    accent: "#a855f7",
  },
] as const;

export type VipProgress = {
  tier: VipTier;
  next: VipTier | null;
  /** 0..1 through the current tier. */
  progress: number;
  /** Volume still needed for the next tier; 0 at the top. */
  remaining: number;
  wagered: number;
};

export const resolveTier = (wagered: number): VipProgress => {
  const sorted = [...VIP_TIERS].sort((a, b) => a.threshold - b.threshold);

  let tier = sorted[0];

  for (const candidate of sorted) {
    if (wagered >= candidate.threshold) {
      tier = candidate;
    }
  }

  const next = sorted.find((candidate) => candidate.threshold > tier.threshold) ?? null;

  if (!next) {
    return { tier, next: null, progress: 1, remaining: 0, wagered };
  }

  const span = next.threshold - tier.threshold;
  const done = wagered - tier.threshold;

  return {
    tier,
    next,
    progress: span > 0 ? Math.min(1, Math.max(0, done / span)) : 1,
    remaining: Math.max(0, next.threshold - wagered),
    wagered,
  };
};

/**
 * Rakeback owed on a period's wagering.
 *
 * Rakeback pays a share of the *house edge* generated, not of turnover — paying a share
 * of turnover on a 2% margin would hand back more than the book made.
 */
export const calcRakeback = (
  wageredInPeriod: number,
  houseEdgeBps: number,
  tier: VipTier,
): number => {
  const grossRevenue = (wageredInPeriod * houseEdgeBps) / 10_000;

  return (grossRevenue * tier.rakebackBps) / 10_000;
};

export const calcMonthlyBonus = (wageredLastMonth: number, tier: VipTier): number =>
  (wageredLastMonth * tier.monthlyBonusBps) / 10_000;

/**
 * Affiliate share of a referred user's generated revenue.
 *
 * Azuro pays affiliates GGR-based rewards for bets carrying their address, and
 * BigMarketV4 already tracks referral volume on-chain. This is the front end's own
 * top-up on that.
 */
export const AFFILIATE_REVENUE_SHARE_BPS = 2_500; // 25% of GGR

export const calcAffiliateReward = (referredWagered: number, houseEdgeBps: number): number => {
  const grossRevenue = (referredWagered * houseEdgeBps) / 10_000;

  return (grossRevenue * AFFILIATE_REVENUE_SHARE_BPS) / 10_000;
};

export const formatTierName = (wagered: number): string => resolveTier(wagered).tier.name;
