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

/**
 * A single earn rule, reduced to what a manual award needs. Built from
 * LoyaltyEarnRuleConfig at the call site.
 */
export type ManualAwardRule = {
  handle: string;
  action: string;
  pointsValue: number | null;
  active: boolean;
  repeatable: boolean;
};

export type ManualAwardResult = {
  status: 'awarded' | 'already_awarded' | 'rejected';
  reason?: string;
  newBalance: number;
  pointsAwarded: number;
  newAwardedRules: string[];
};

/**
 * Pure projection for a manual earn-rule award. Decides whether the rule can be
 * awarded and computes the resulting balance + awardedRules ledger.
 *
 * - Inactive rule or non-positive pointsValue -> rejected (no change).
 * - One-time rule (repeatable === false) already in awardedRules -> already_awarded.
 * - Otherwise -> awarded; one-time rules append their handle to awardedRules,
 *   repeatable rules leave awardedRules unchanged.
 *
 * Manual eligibility by ACTION is enforced at the call site, not here.
 */
export function projectManualAward({
  rule,
  currentBalance,
  awardedRules,
}: {
  rule: ManualAwardRule;
  currentBalance: number;
  awardedRules: string[];
}): ManualAwardResult {
  if (!rule.active) {
    return {
      status: 'rejected',
      reason: 'Rule is inactive',
      newBalance: currentBalance,
      pointsAwarded: 0,
      newAwardedRules: awardedRules,
    };
  }

  if (rule.pointsValue === null || rule.pointsValue <= 0) {
    return {
      status: 'rejected',
      reason: 'Rule has no positive points value',
      newBalance: currentBalance,
      pointsAwarded: 0,
      newAwardedRules: awardedRules,
    };
  }

  if (!rule.repeatable && awardedRules.includes(rule.handle)) {
    return {
      status: 'already_awarded',
      newBalance: currentBalance,
      pointsAwarded: 0,
      newAwardedRules: awardedRules,
    };
  }

  return {
    status: 'awarded',
    newBalance: currentBalance + rule.pointsValue,
    pointsAwarded: rule.pointsValue,
    newAwardedRules: rule.repeatable
      ? awardedRules
      : [...new Set([...awardedRules, rule.handle])],
  };
}
