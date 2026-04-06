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
};

export function buildCustomerLoyaltyState({
  computedAt = new Date().toISOString(),
  metrics,
  program,
}: {
  computedAt?: string;
  metrics: CustomerMetricSnapshot;
  program: LoyaltyProgramConfig;
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
