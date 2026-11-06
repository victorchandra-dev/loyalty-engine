import type {LoyaltyBenefitConfig, LoyaltyProgramConfig} from './program.js';

export type LoyaltyDiscountConfiguration = {
  currencyCode: string;
  generatedAt: string;
  tiers: Array<{
    tierHandle: string;
    threshold: number;
    percentage: number;
    label: string;
  }>;
};

export function buildDiscountConfiguration(
  program: LoyaltyProgramConfig,
): LoyaltyDiscountConfiguration {
  return {
    currencyCode: program.currencyCode,
    generatedAt: new Date().toISOString(),
    tiers: program.tiers
      .map((tier) => {
        const benefit = getDiscountBenefit(program, tier.handle);

        if (!benefit || benefit.value === null) {
          return null;
        }

        return {
          tierHandle: tier.handle,
          threshold: tier.minimumValue,
          percentage: benefit.value,
          label: benefit.displayLabel,
        };
      })
      .filter(
        (tier): tier is LoyaltyDiscountConfiguration['tiers'][number] =>
          tier !== null,
      ),
  };
}

function getDiscountBenefit(
  program: LoyaltyProgramConfig,
  tierHandle: string,
): LoyaltyBenefitConfig | null {
  return (
    program.benefits.find(
      (benefit) =>
        benefit.active &&
        benefit.tierHandle === tierHandle &&
        benefit.type === 'discount_percentage',
    ) ?? null
  );
}

/** One built-in automatic discount per tier that gives a percentage off. */
export type TierDiscountPlanEntry = {
  tierHandle: string;
  title: string;
  percentage: number;
  /** Shopify customer segment query selecting this tier's customers. */
  segmentQuery: string;
};

/**
 * The tier discounts Shopify should run, as built-in automatic discounts
 * limited to customer segments (custom apps can't use Functions off Plus).
 * Each range ends where the next discount tier starts, so a customer matches
 * exactly one and tier discounts never stack with each other.
 *
 * ponytail: tiers only use lifetime spend (normalizeTierEntries sets
 * `lifetime_spend`), so the query only needs `amount_spent`. Both it and the
 * engine's amountSpent are net of refunds (checked on the live store, 6 Nov).
 */
export function buildTierDiscountPlan(
  program: LoyaltyProgramConfig,
): TierDiscountPlanEntry[] {
  const discounted = program.tiers
    .map((tier) => ({tier, benefit: getDiscountBenefit(program, tier.handle)}))
    .filter(({benefit}) => benefit?.value != null && benefit.value > 0);

  return discounted.map(({tier, benefit}, index) => {
    const next = discounted[index + 1]?.tier;
    return {
      tierHandle: tier.handle,
      title: `${tier.name} – ${benefit!.displayLabel}`,
      percentage: benefit!.value!,
      segmentQuery: next
        ? `amount_spent >= ${tier.minimumValue} AND amount_spent < ${next.minimumValue}`
        : `amount_spent >= ${tier.minimumValue}`,
    };
  });
}
