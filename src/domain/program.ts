export const LOYALTY_METAOBJECT_TYPES = {
  tier: 'loyalty_reward_tier',
  benefit: 'loyalty_reward_benefit',
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

export type LoyaltyProgramConfig = {
  currencyCode: string;
  tiers: LoyaltyTierConfig[];
  benefits: LoyaltyBenefitConfig[];
};

export type NormalizeProgramResult = {
  program: LoyaltyProgramConfig | null;
  issues: ProgramConfigIssue[];
};

export function normalizeLoyaltyProgram({
  currencyCode,
  tierEntries,
  benefitEntries = [],
}: {
  currencyCode: string;
  tierEntries: MerchantMetaobjectEntry[];
  benefitEntries?: MerchantMetaobjectEntry[];
}): NormalizeProgramResult {
  const tierResult = normalizeTierEntries(tierEntries);
  const benefitResult = normalizeBenefitEntries(benefitEntries);
  const issues = [...tierResult.issues, ...benefitResult.issues];

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
