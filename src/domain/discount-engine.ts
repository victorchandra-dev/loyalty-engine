import {
  buildCustomerLoyaltyState,
  type CustomerMetricSnapshot,
  type CustomerLoyaltyState,
} from './customer-state.js';
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

export type LoyaltyDiscountDecision = {
  label: string;
  percentage: number;
  benefitHandle: string;
  tierHandle: string;
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

export function resolveDiscountDecision({
  customerState,
  program,
}: {
  customerState: CustomerLoyaltyState;
  program: LoyaltyProgramConfig;
}): LoyaltyDiscountDecision | null {
  if (!customerState.currentTierHandle) {
    return null;
  }

  const benefit = getDiscountBenefit(program, customerState.currentTierHandle);

  if (!benefit || benefit.value === null || benefit.value <= 0) {
    return null;
  }

  return {
    label: benefit.displayLabel,
    percentage: benefit.value,
    benefitHandle: benefit.handle,
    tierHandle: customerState.currentTierHandle,
  };
}

export function resolveDiscountDecisionFromMetrics({
  metrics,
  program,
}: {
  metrics: CustomerMetricSnapshot;
  program: LoyaltyProgramConfig;
}) {
  const customerState = buildCustomerLoyaltyState({metrics, program});
  return resolveDiscountDecision({customerState, program});
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
