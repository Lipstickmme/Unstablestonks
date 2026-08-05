// KYC tiers and jurisdiction gating.
//
// A book that takes fiat needs to know who it is taking it from, and needs to refuse
// business it is not licensed for. This module is the *policy* layer — thresholds, what
// each tier unlocks, which markets are off-limits. Verification itself is the ramp
// provider's or a dedicated KYC vendor's job; nothing here handles documents.
//
// The restricted list below is a conservative starting point covering jurisdictions that
// broadly prohibit online gambling or where sanctions apply. It is not legal advice, and
// an operator must replace it with the list their counsel and licence require.

export enum KycTier {
  /** Wallet only. Crypto in, crypto out, capped. */
  None = 0,
  /** Email + basic details. */
  Basic = 1,
  /** Government ID verified. */
  Verified = 2,
  /** ID + proof of address + source of funds. */
  Enhanced = 3,
}

export type KycTierPolicy = {
  tier: KycTier;
  name: string;
  /** Cumulative fiat-equivalent deposits allowed, per period. Infinity means uncapped. */
  depositLimitPerMonth: number;
  withdrawalLimitPerMonth: number;
  /** Can this tier use card / bank rails at all? */
  fiatEnabled: boolean;
  requirements: string[];
};

export const KYC_POLICIES: readonly KycTierPolicy[] = [
  {
    tier: KycTier.None,
    name: "Unverified",
    depositLimitPerMonth: 0,
    withdrawalLimitPerMonth: 0,
    fiatEnabled: false,
    requirements: ["Connect a wallet"],
  },
  {
    tier: KycTier.Basic,
    name: "Basic",
    depositLimitPerMonth: 1_000,
    withdrawalLimitPerMonth: 1_000,
    fiatEnabled: true,
    requirements: ["Verified email", "Name and date of birth"],
  },
  {
    tier: KycTier.Verified,
    name: "Verified",
    depositLimitPerMonth: 25_000,
    withdrawalLimitPerMonth: 25_000,
    fiatEnabled: true,
    requirements: ["Government photo ID", "Liveness check"],
  },
  {
    tier: KycTier.Enhanced,
    name: "Enhanced",
    depositLimitPerMonth: Number.POSITIVE_INFINITY,
    withdrawalLimitPerMonth: Number.POSITIVE_INFINITY,
    fiatEnabled: true,
    requirements: ["Proof of address", "Source of funds"],
  },
] as const;

export const policyFor = (tier: KycTier): KycTierPolicy =>
  KYC_POLICIES.find((policy) => policy.tier === tier) ?? KYC_POLICIES[0];

/**
 * ISO 3166-1 alpha-2 codes the platform will not serve.
 *
 * Replace with the list your licence mandates before going live — an out-of-date list
 * here is a compliance problem, not a cosmetic one.
 */
export const RESTRICTED_COUNTRIES: readonly string[] = [
  "US", // state-by-state licensing; excluded wholesale until licensed
  "GB", // requires a UKGC licence
  "FR",
  "NL",
  "AU",
  "SG",
  "KP",
  "IR",
  "SY",
  "CU",
  "RU",
  "BY",
] as const;

export const isRestrictedCountry = (countryCode: string | undefined): boolean =>
  Boolean(countryCode) && RESTRICTED_COUNTRIES.includes(countryCode!.toUpperCase());

export type KycGate = { allowed: true } | { allowed: false; reason: string; requiredTier?: KycTier };

export type KycProfile = {
  tier: KycTier;
  countryCode?: string;
  /** Fiat-equivalent moved this month, for limit evaluation. */
  depositedThisMonth: number;
  withdrawnThisMonth: number;
};

/** Can this profile move this much fiat right now? */
export const checkFiatAction = (
  profile: KycProfile,
  direction: "deposit" | "withdrawal",
  amount: number,
): KycGate => {
  if (isRestrictedCountry(profile.countryCode)) {
    return {
      allowed: false,
      reason: "We are not licensed to serve players in your jurisdiction.",
    };
  }

  const policy = policyFor(profile.tier);

  if (!policy.fiatEnabled) {
    return {
      allowed: false,
      reason: "Verify your identity to deposit or withdraw with a card or bank account.",
      requiredTier: KycTier.Basic,
    };
  }

  const used = direction === "deposit" ? profile.depositedThisMonth : profile.withdrawnThisMonth;
  const cap =
    direction === "deposit" ? policy.depositLimitPerMonth : policy.withdrawalLimitPerMonth;
  const remaining = cap - used;

  if (amount > remaining) {
    const nextTier = KYC_POLICIES.find((candidate) => candidate.tier > profile.tier);

    return {
      allowed: false,
      reason: nextTier
        ? `Your ${policy.name} tier allows ${remaining.toFixed(0)} more this month. Upgrade to ${nextTier.name} to raise it.`
        : `Your monthly limit leaves ${remaining.toFixed(0)}.`,
      requiredTier: nextTier?.tier,
    };
  }

  return { allowed: true };
};

/** Betting itself is wallet-gated, not KYC-gated — but jurisdiction still applies. */
export const checkBetting = (profile: KycProfile): KycGate => {
  if (isRestrictedCountry(profile.countryCode)) {
    return {
      allowed: false,
      reason: "We are not licensed to serve players in your jurisdiction.",
    };
  }

  return { allowed: true };
};
