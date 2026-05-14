import type {
  LoyaltyBenefitConfig,
  LoyaltyProgramConfig,
  LoyaltyTierConfig,
} from './program.js';

export type CustomerMetricSnapshot = {
  lifetimeSpend: number;
  paidOrderCount: number;
  pointsBalance: number;
  currencyCode: string;
};

export type CustomerLoyaltyState = {
  computedAt: string;
  currentTierHandle: string | null;
  qualifiedTierHandles: string[];
  activeBenefitHandles: string[];
  metrics: CustomerMetricSnapshot;
  /**
   * Action codes of one-shot earn rules already credited to this customer
   * (signup, birthday-2026, etc.). Used to prevent double-awarding. Optional
   * because legacy state records won't have it; missing means "none awarded".
   */
  awardedRules?: string[];
  /**
   * GID of the last order that triggered a points award. Used by the
   * orders/paid webhook handler to skip duplicate deliveries.
   */
  lastOrderId?: string;
};

export function buildCustomerLoyaltyState({
  computedAt = new Date().toISOString(),
  metrics,
  program,
  awardedRules,
  lastOrderId,
}: {
  computedAt?: string;
  metrics: CustomerMetricSnapshot;
  program: LoyaltyProgramConfig;
  awardedRules?: string[];
  lastOrderId?: string;
}): CustomerLoyaltyState {
  const qualifiedTiers = getQualifiedTiers(program, metrics);
  const currentTier = qualifiedTiers.at(-1) ?? null;
  const activeBenefits = getActiveBenefits(
    program,
    currentTier?.handle ?? null,
  );

  return {
    computedAt,
    currentTierHandle: currentTier?.handle ?? null,
    qualifiedTierHandles: qualifiedTiers.map((tier) => tier.handle),
    activeBenefitHandles: activeBenefits.map((benefit) => benefit.handle),
    metrics,
    ...(awardedRules && awardedRules.length > 0
      ? {awardedRules: [...new Set(awardedRules)]}
      : {}),
    ...(lastOrderId ? {lastOrderId} : {}),
  };
}

export function getQualifiedTiers(
  program: LoyaltyProgramConfig,
  metrics: CustomerMetricSnapshot,
) {
  return program.tiers.filter((tier) => isTierQualified(tier, metrics));
}

export function getCurrentTier(
  program: LoyaltyProgramConfig,
  metrics: CustomerMetricSnapshot,
) {
  return getQualifiedTiers(program, metrics).at(-1) ?? null;
}

export function getActiveBenefits(
  program: LoyaltyProgramConfig,
  tierHandle: string | null,
) {
  if (!tierHandle) {
    return [] as LoyaltyBenefitConfig[];
  }

  return program.benefits.filter(
    (benefit) => benefit.active && benefit.tierHandle === tierHandle,
  );
}

function isTierQualified(
  tier: LoyaltyTierConfig,
  metrics: CustomerMetricSnapshot,
) {
  switch (tier.metric) {
    case 'lifetime_spend':
      return metrics.lifetimeSpend >= tier.minimumValue;
    case 'paid_order_count':
      return metrics.paidOrderCount >= tier.minimumValue;
    case 'points_balance':
      return metrics.pointsBalance >= tier.minimumValue;
  }
}
