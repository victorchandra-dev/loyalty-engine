export const LOYALTY_METAOBJECT_TYPES = {
  tier: 'loyalty_reward_tier',
  benefit: 'loyalty_reward_benefit',
  earnRule: 'loyalty_earn_rule',
  redemption: 'loyalty_redemption',
} as const;

export type LoyaltyMetric =
  | 'lifetime_spend'
  | 'paid_order_count'
  | 'points_balance';

export type LoyaltyBenefitType =
  | 'discount_percentage'
  | 'discount_fixed_amount'
  | 'free_shipping'
  | 'gift'
  | 'perk'
  | 'content_access';

export type LoyaltyEarnAction =
  | 'signup'
  | 'order'
  | 'birthday'
  | 'follow_instagram'
  | 'follow_tiktok'
  | 'review'
  | 'referral'
  | 'newsletter'
  | 'custom';

export type LoyaltyRedemptionRewardType =
  | 'fixed_discount'
  | 'percent_discount';

export type MerchantMetaobjectEntry = {
  id: string;
  handle: string;
  type: string;
  fields: Record<string, string | null | undefined>;
};

export type ProgramConfigIssue = {
  entryId: string;
  field: string;
  message: string;
  severity: 'error' | 'warning';
};

export type LoyaltyTierConfig = {
  id: string;
  handle: string;
  name: string;
  metric: LoyaltyMetric;
  minimumValue: number;
  order: number;
};

export type LoyaltyBenefitConfig = {
  id: string;
  handle: string;
  tierHandle: string;
  name: string;
  type: LoyaltyBenefitType;
  value: number | null;
  displayLabel: string;
  description: string | null;
  active: boolean;
  metadata: Record<string, unknown> | null;
};

export type LoyaltyEarnRuleConfig = {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  // Action codes the engine doesn't recognise are surfaced verbatim so the
  // storefront can render unknown labels without crashing — the points-awarding
  // worker simply ignores them.
  action: LoyaltyEarnAction | string;
  pointsValue: number | null;
  active: boolean;
  repeatable: boolean;
};

export type LoyaltyRedemptionConfig = {
  id: string;
  handle: string;
  title: string;
  description: string | null;
  pointsCost: number;
  // Same forward-compat behaviour as earn rules.
  rewardType: LoyaltyRedemptionRewardType | string;
  rewardValue: string | null;
  active: boolean;
};

export type LoyaltyProgramConfig = {
  currencyCode: string;
  tiers: LoyaltyTierConfig[];
  benefits: LoyaltyBenefitConfig[];
  earnRules: LoyaltyEarnRuleConfig[];
  redemptions: LoyaltyRedemptionConfig[];
};

const KNOWN_EARN_ACTIONS: ReadonlySet<LoyaltyEarnAction> = new Set([
  'signup',
  'order',
  'birthday',
  'follow_instagram',
  'follow_tiktok',
  'review',
  'referral',
  'newsletter',
  'custom',
]);

const KNOWN_REWARD_TYPES: ReadonlySet<LoyaltyRedemptionRewardType> = new Set([
  'fixed_discount',
  'percent_discount',
]);

/**
 * Compute points to award for a paid order, given the active earn rules.
 *
 * Rules with `action === 'order'` apply per-order:
 *   - If `pointsValue` is set, that flat amount is added.
 *   - If `pointsValue` is null, the order awards 1 point per whole currency
 *     unit of order amount (the storefront-default 1pt/$1 contract).
 *
 * Rules with one-shot actions (signup, birthday, etc.) are NOT awarded by this
 * function — they're handled by their own triggers, not the orders/paid hook.
 *
 * Returns 0 if no `order` earn rule exists or none are active.
 */
export function computeOrderPoints({
  orderAmount,
  earnRules,
}: {
  orderAmount: number;
  earnRules: LoyaltyEarnRuleConfig[];
}): number {
  if (!Number.isFinite(orderAmount) || orderAmount <= 0) {
    return 0;
  }

  let total = 0;
  for (const rule of earnRules) {
    if (!rule.active) continue;
    if (rule.action !== 'order') continue;

    if (rule.pointsValue === null) {
      // Dynamic accrual: 1pt per whole currency unit
      total += Math.floor(orderAmount);
    } else {
      total += Math.max(0, rule.pointsValue);
    }
  }

  return total;
}

/**
 * Returns the points value to award for a one-shot earn rule (signup,
 * birthday, etc.). Used by their own triggers (not orders/paid). Returns 0 if
 * the rule isn't found or is inactive.
 */
export function getOneShotEarnPoints(
  action: LoyaltyEarnAction,
  earnRules: LoyaltyEarnRuleConfig[],
): number {
  const rule = earnRules.find(
    (candidate) => candidate.active && candidate.action === action,
  );
  return rule?.pointsValue ?? 0;
}

export type NormalizeProgramResult = {
  program: LoyaltyProgramConfig | null;
  issues: ProgramConfigIssue[];
};

export function normalizeLoyaltyProgram({
  currencyCode,
  tierEntries,
  benefitEntries = [],
  earnRuleEntries = [],
  redemptionEntries = [],
}: {
  currencyCode: string;
  tierEntries: MerchantMetaobjectEntry[];
  benefitEntries?: MerchantMetaobjectEntry[];
  earnRuleEntries?: MerchantMetaobjectEntry[];
  redemptionEntries?: MerchantMetaobjectEntry[];
}): NormalizeProgramResult {
  const tierResult = normalizeTierEntries(tierEntries);
  const benefitResult = normalizeBenefitEntries(benefitEntries);
  const earnRuleResult = normalizeEarnRuleEntries(earnRuleEntries);
  const redemptionResult = normalizeRedemptionEntries(redemptionEntries);
  const issues = [
    ...tierResult.issues,
    ...benefitResult.issues,
    ...earnRuleResult.issues,
    ...redemptionResult.issues,
  ];

  if (tierResult.tiers.length === 0) {
    return {program: null, issues};
  }

  return {
    program: {
      currencyCode,
      tiers: tierResult.tiers,
      benefits: mergeTierBenefits({
        tierBenefits: tierResult.inlineBenefits,
        explicitBenefits: benefitResult.benefits,
        tierHandles: tierResult.tiers.map((tier) => tier.handle),
      }),
      earnRules: earnRuleResult.earnRules,
      redemptions: redemptionResult.redemptions,
    },
    issues,
  };
}

export function normalizeTierEntries(entries: MerchantMetaobjectEntry[]) {
  const issues: ProgramConfigIssue[] = [];
  const tiers: LoyaltyTierConfig[] = [];
  const inlineBenefits: LoyaltyBenefitConfig[] = [];

  for (const entry of entries) {
    if (entry.type !== LOYALTY_METAOBJECT_TYPES.tier) {
      continue;
    }

    const name = getRequiredString(entry, 'label', issues);
    const minimumValue = getRequiredNumber(entry, 'minimum_spend', issues);
    const order = tiers.length;

    if (name === null || minimumValue === null) {
      continue;
    }

    tiers.push({
      id: entry.id,
      handle: entry.handle,
      name,
      metric: 'lifetime_spend',
      minimumValue,
      order,
    });

    const discountPercentage = getOptionalNumber(
      entry,
      'discount_percentage',
      issues,
    );

    if (discountPercentage && discountPercentage > 0) {
      inlineBenefits.push({
        id: `${entry.id}:discount_percentage`,
        handle: `${entry.handle}-discount-percentage`,
        tierHandle: entry.handle,
        name: `${name} discount`,
        type: 'discount_percentage',
        value: discountPercentage,
        displayLabel: `${discountPercentage}% off`,
        description: null,
        active: true,
        metadata: {
          source: 'tier_entry',
          sourceField: 'discount_percentage',
        },
      });
    }
  }

  tiers.sort((left, right) => left.minimumValue - right.minimumValue);

  tiers.forEach((tier, index) => {
    tier.order = index;
  });

  return {tiers, inlineBenefits, issues};
}

export function normalizeBenefitEntries(entries: MerchantMetaobjectEntry[]) {
  const issues: ProgramConfigIssue[] = [];
  const benefits: LoyaltyBenefitConfig[] = [];

  for (const entry of entries) {
    if (entry.type !== LOYALTY_METAOBJECT_TYPES.benefit) {
      continue;
    }

    const name = getRequiredString(entry, 'label', issues);
    const tierHandle = getRequiredString(entry, 'tier_handle', issues);
    const type = getBenefitType(entry, issues);
    const displayLabel =
      getOptionalString(entry, 'display_label') ?? name ?? entry.handle;
    const description = getOptionalString(entry, 'description');
    const value = getOptionalNumber(entry, 'benefit_value', issues);
    const active = getOptionalBoolean(entry, 'active') ?? true;
    const metadata = getOptionalJson(entry, 'metadata_json', issues);

    if (name === null || tierHandle === null || type === null) {
      continue;
    }

    benefits.push({
      id: entry.id,
      handle: entry.handle,
      tierHandle,
      name,
      type,
      value,
      displayLabel,
      description,
      active,
      metadata,
    });
  }

  return {benefits, issues};
}

export function normalizeEarnRuleEntries(entries: MerchantMetaobjectEntry[]) {
  const issues: ProgramConfigIssue[] = [];
  const earnRules: LoyaltyEarnRuleConfig[] = [];

  for (const entry of entries) {
    if (entry.type !== LOYALTY_METAOBJECT_TYPES.earnRule) {
      continue;
    }

    const title = getRequiredString(entry, 'title', issues);
    const action = getRequiredString(entry, 'action', issues);

    if (title === null || action === null) {
      continue;
    }

    if (!KNOWN_EARN_ACTIONS.has(action as LoyaltyEarnAction)) {
      issues.push({
        entryId: entry.id,
        field: 'action',
        message: `Unknown action code: ${action}. Will surface in the storefront but the engine will not auto-award points for it.`,
        severity: 'warning',
      });
    }

    earnRules.push({
      id: entry.id,
      handle: entry.handle,
      title,
      description: getOptionalString(entry, 'description'),
      action: action as LoyaltyEarnAction | string,
      pointsValue: getOptionalNumber(entry, 'points_value', issues),
      active: getOptionalBoolean(entry, 'active') ?? true,
      repeatable: getOptionalBoolean(entry, 'repeatable') ?? false,
    });
  }

  return {earnRules: earnRules.filter((rule) => rule.active), issues};
}

export function normalizeRedemptionEntries(entries: MerchantMetaobjectEntry[]) {
  const issues: ProgramConfigIssue[] = [];
  const redemptions: LoyaltyRedemptionConfig[] = [];

  for (const entry of entries) {
    if (entry.type !== LOYALTY_METAOBJECT_TYPES.redemption) {
      continue;
    }

    const title = getRequiredString(entry, 'title', issues);
    const rewardType = getRequiredString(entry, 'reward_type', issues);
    const pointsCost = getRequiredNumber(entry, 'points_cost', issues);

    if (title === null || rewardType === null || pointsCost === null) {
      continue;
    }

    if (!KNOWN_REWARD_TYPES.has(rewardType as LoyaltyRedemptionRewardType)) {
      issues.push({
        entryId: entry.id,
        field: 'reward_type',
        message: `Unknown reward type: ${rewardType}. Will surface in the storefront but the discount function may not apply it.`,
        severity: 'warning',
      });
    }

    redemptions.push({
      id: entry.id,
      handle: entry.handle,
      title,
      description: getOptionalString(entry, 'description'),
      pointsCost,
      rewardType: rewardType as LoyaltyRedemptionRewardType | string,
      rewardValue: getOptionalString(entry, 'reward_value'),
      active: getOptionalBoolean(entry, 'active') ?? true,
    });
  }

  return {
    redemptions: redemptions
      .filter((reward) => reward.active)
      .sort((left, right) => left.pointsCost - right.pointsCost),
    issues,
  };
}

function getBenefitType(
  entry: MerchantMetaobjectEntry,
  issues: ProgramConfigIssue[],
): LoyaltyBenefitType | null {
  const value = getRequiredString(entry, 'benefit_type', issues);

  if (value === null) {
    return null;
  }

  const benefitType = value as LoyaltyBenefitType;

  if (
    benefitType !== 'discount_percentage' &&
    benefitType !== 'discount_fixed_amount' &&
    benefitType !== 'free_shipping' &&
    benefitType !== 'gift' &&
    benefitType !== 'perk' &&
    benefitType !== 'content_access'
  ) {
    issues.push({
      entryId: entry.id,
      field: 'benefit_type',
      message: `Unsupported benefit type: ${value}`,
      severity: 'error',
    });

    return null;
  }

  return benefitType;
}

function mergeTierBenefits({
  tierBenefits,
  explicitBenefits,
  tierHandles,
}: {
  tierBenefits: LoyaltyBenefitConfig[];
  explicitBenefits: LoyaltyBenefitConfig[];
  tierHandles: string[];
}) {
  const knownTierHandles = new Set(tierHandles);
  const explicitBenefitKeys = new Set(
    explicitBenefits.map((benefit) => `${benefit.tierHandle}:${benefit.type}`),
  );

  const filteredTierBenefits = tierBenefits.filter(
    (benefit) =>
      knownTierHandles.has(benefit.tierHandle) &&
      !explicitBenefitKeys.has(`${benefit.tierHandle}:${benefit.type}`),
  );

  return [...filteredTierBenefits, ...explicitBenefits].filter((benefit) =>
    knownTierHandles.has(benefit.tierHandle),
  );
}

function getRequiredString(
  entry: MerchantMetaobjectEntry,
  field: string,
  issues: ProgramConfigIssue[],
) {
  const value = getOptionalString(entry, field);

  if (!value) {
    issues.push({
      entryId: entry.id,
      field,
      message: 'A value is required.',
      severity: 'error',
    });

    return null;
  }

  return value;
}

function getOptionalString(entry: MerchantMetaobjectEntry, field: string) {
  return entry.fields[field]?.trim() || null;
}

function getRequiredNumber(
  entry: MerchantMetaobjectEntry,
  field: string,
  issues: ProgramConfigIssue[],
) {
  const value = getOptionalNumber(entry, field, issues);

  if (value === null) {
    issues.push({
      entryId: entry.id,
      field,
      message: 'A numeric value is required.',
      severity: 'error',
    });

    return null;
  }

  return value;
}

function getOptionalNumber(
  entry: MerchantMetaobjectEntry,
  field: string,
  issues: ProgramConfigIssue[],
) {
  const value = entry.fields[field];

  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsedValue = Number.parseFloat(value);

  if (!Number.isFinite(parsedValue)) {
    issues.push({
      entryId: entry.id,
      field,
      message: `Invalid numeric value: ${value}`,
      severity: 'error',
    });

    return null;
  }

  return parsedValue;
}

function getOptionalBoolean(entry: MerchantMetaobjectEntry, field: string) {
  const value = entry.fields[field];

  if (value === null || value === undefined || value === '') {
    return null;
  }

  return value === 'true';
}

function getOptionalJson(
  entry: MerchantMetaobjectEntry,
  field: string,
  issues: ProgramConfigIssue[],
) {
  const value = entry.fields[field];

  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    issues.push({
      entryId: entry.id,
      field,
      message: 'Invalid JSON payload.',
      severity: 'error',
    });

    return null;
  }
}
