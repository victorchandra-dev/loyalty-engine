import {buildDiscountConfiguration} from '../domain/discount-engine.js';
import {
  LOYALTY_METAOBJECT_TYPES,
  normalizeLoyaltyProgram,
  type MerchantMetaobjectEntry,
} from '../domain/program.js';

export type MetaobjectWebhookPayload = {
  type?: string | null;
};

export type MetaobjectConfigSyncResult = ReturnType<
  typeof buildMetaobjectSyncPlan
>;

export function isLoyaltyConfigMetaobject(payload: MetaobjectWebhookPayload) {
  return (
    payload.type === LOYALTY_METAOBJECT_TYPES.tier ||
    payload.type === LOYALTY_METAOBJECT_TYPES.benefit
  );
}

export function buildMetaobjectSyncPlan({
  currencyCode,
  tierEntries,
  benefitEntries,
}: {
  currencyCode: string;
  tierEntries: MerchantMetaobjectEntry[];
  benefitEntries: MerchantMetaobjectEntry[];
}) {
  const normalized = normalizeLoyaltyProgram({
    currencyCode,
    tierEntries,
    benefitEntries,
  });

  if (!normalized.program) {
    return {
      program: null,
      issues: normalized.issues,
      discountConfiguration: null,
    };
  }

  return {
    program: normalized.program,
    issues: normalized.issues,
    discountConfiguration: buildDiscountConfiguration(normalized.program),
  };
}
