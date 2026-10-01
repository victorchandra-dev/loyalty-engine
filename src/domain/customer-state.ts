import {computeOrderPoints, getOneShotEarnPoints} from './program.js';
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
};

export function buildCustomerLoyaltyState({
  computedAt = new Date().toISOString(),
  metrics,
  program,
  awardedRules,
}: {
  computedAt?: string;
  metrics: CustomerMetricSnapshot;
  program: LoyaltyProgramConfig;
  awardedRules?: string[];
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

/**
 * How long a redeemed reward stays usable at checkout (owner's call, 1 Oct
 * 2026: 30 days). The storefront shows and hides the reward by this expiry,
 * so it must stay on the record. Unused rewards don't return their points.
 */
export const REDEMPTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** The reward a customer has redeemed and not yet used at checkout. */
export type ActiveRedemption = {
  handle: string;
  rewardType: string;
  rewardValue: string | null;
  pointsCost: number;
  expiresAt: string;
  redemptionId: string | null;
  redeemedAt: string;
  /** The single-use discount code for this reward (null on old records). */
  code: string | null;
  /** Shopify discount ID of that code, set once the code is created. */
  discountId: string | null;
};

/** Everything the engine reads about one customer before changing points. */
export type LoyaltyCustomer = {
  id: string;
  balance: number;
  /** compareDigest of the balance metafield; null when it doesn't exist yet. */
  balanceDigest: string | null;
  awardedRules: string[];
  activeRedemption: ActiveRedemption | null;
  referrerId: string | null;
  referralCredited: boolean;
  lifetimeSpend: number;
  paidOrderCount: number;
  currencyCode: string;
};

export function isRedemptionActive(
  redemption: ActiveRedemption | null,
  now: Date,
): boolean {
  return redemption !== null && Date.parse(redemption.expiresAt) > now.getTime();
}

/**
 * What a paid order changes: order points, the signup bonus on the first
 * paid order, the referral bonus on a referred customer's first paid order
 * (plus the referrer's matching credit), and clearing a reward that checkout
 * already applied to this order.
 */
export function projectPaidOrder({
  customer,
  program,
  orderAmount,
  discountCodes,
}: {
  customer: LoyaltyCustomer;
  program: LoyaltyProgramConfig;
  orderAmount: number;
  /** Codes the order used, from the orders/paid payload. */
  discountCodes: string[];
}): {
  balance: number;
  /** The non-zero parts of this order's points, one history row each. */
  earned: Array<{type: 'order' | 'signup' | 'referral'; points: number}>;
  awardedRules: string[];
  clearRedemption: boolean;
  referral: {referrerId: string; points: number} | null;
} {
  const earned: Array<{type: 'order' | 'signup' | 'referral'; points: number}> = [];
  const orderPoints = computeOrderPoints({orderAmount, earnRules: program.earnRules});
  if (orderPoints > 0) earned.push({type: 'order', points: orderPoints});
  const awardedRules = [...customer.awardedRules];

  if (!awardedRules.includes('signup')) {
    const signup = getOneShotEarnPoints('signup', program.earnRules);
    if (signup > 0) {
      earned.push({type: 'signup', points: signup});
      awardedRules.push('signup');
    }
  }

  let referral: {referrerId: string; points: number} | null = null;
  if (
    customer.referrerId &&
    !customer.referralCredited &&
    customer.referrerId !== customer.id
  ) {
    const bonus = getOneShotEarnPoints('referral', program.earnRules);
    if (bonus > 0) {
      earned.push({type: 'referral', points: bonus});
      referral = {referrerId: customer.referrerId, points: bonus};
    }
  }

  // The reward is used once this order carries its code (Shopify codes are
  // case-insensitive). Shopify's usage limit stops reuse either way.
  const code = customer.activeRedemption?.code?.toLowerCase();
  const clearRedemption =
    code != null && discountCodes.some((used) => used.toLowerCase() === code);

  const points = earned.reduce((sum, part) => sum + part.points, 0);
  return {
    balance: Math.max(0, customer.balance + points),
    earned,
    awardedRules,
    clearRedemption,
    referral,
  };
}

/** Redeem a reward: one active reward at a time, paid for up front. */
export function projectRedemption({
  customer,
  program,
  handle,
  now,
  code,
}: {
  customer: LoyaltyCustomer;
  program: LoyaltyProgramConfig;
  handle: string;
  now: Date;
  /** The discount code the caller will create for this reward. */
  code: string;
}):
  | {ok: true; balance: number; activeRedemption: ActiveRedemption}
  | {ok: false; status: 400 | 404 | 409; message: string} {
  const reward = program.redemptions.find(
    (entry) => entry.handle === handle && entry.active,
  );
  if (!reward) {
    return {ok: false, status: 404, message: `No active reward "${handle}".`};
  }
  if (isRedemptionActive(customer.activeRedemption, now)) {
    return {
      ok: false,
      status: 409,
      message: 'You already have a reward waiting. Use it at checkout first.',
    };
  }
  if (customer.balance < reward.pointsCost) {
    return {
      ok: false,
      status: 400,
      message: `You have ${customer.balance} points; this reward needs ${reward.pointsCost}.`,
    };
  }

  return {
    ok: true,
    balance: customer.balance - reward.pointsCost,
    activeRedemption: {
      handle: reward.handle,
      rewardType: reward.rewardType,
      rewardValue: reward.rewardValue ?? null,
      pointsCost: reward.pointsCost,
      expiresAt: new Date(now.getTime() + REDEMPTION_TTL_MS).toISOString(),
      redemptionId: reward.id,
      redeemedAt: now.toISOString(),
      code,
      discountId: null,
    },
  };
}
