import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {METAFIELDS_SET_MUTATION} from '../../src/integrations/shopify/admin-operations.js';
import type {LoyaltyProgramConfig} from '../../src/domain/program.js';
import {
  buildCustomerLoyaltyState,
  projectManualAward,
  type ActiveRedemption,
  type LoyaltyCustomer,
  type ManualAwardRule,
} from '../../src/domain/customer-state.js';
import {
  APP_METAFIELD_NAMESPACE,
  CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
  CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
  CUSTOMER_LOYALTY_REFERRED_BY_CREDITED_KEY,
  CUSTOMER_LOYALTY_REFERRED_BY_KEY,
  CUSTOMER_LOYALTY_STATE_KEY,
  isManualEarnEligible,
} from './constants';
import {adminGraphql, assertNoUserErrors} from './graphql.server';

type MetafieldsSetMutationData = {
  metafieldsSet: {
    userErrors: Array<{
      field?: Array<string | number> | null;
      message: string;
    }>;
  };
};

// ----------------------------------------------------------------------------
// Reading: the program snapshot, and everything about one customer
// ----------------------------------------------------------------------------

const PROGRAM_SNAPSHOT_QUERY = `#graphql
  query LoyaltyProgramSnapshot {
    shop {
      snapshot: metafield(namespace: "$app", key: "loyalty_program_snapshot") {
        value
      }
    }
  }
` as const;

/**
 * The program as the discount function sees it: the shop snapshot written by
 * syncShopProgramSnapshot on every admin save, metaobject change and toggle.
 * One small read instead of the full metaobject query.
 */
export async function loadProgramSnapshot(
  admin: AdminApiContext,
): Promise<{enabled: boolean; program: LoyaltyProgramConfig | null}> {
  const data = await adminGraphql<{shop: {snapshot: {value: string} | null}}>(
    admin,
    PROGRAM_SNAPSHOT_QUERY,
  );
  const snapshot = parseJson(data.shop.snapshot?.value) as {
    enabled?: boolean;
    program?: LoyaltyProgramConfig | null;
  } | null;
  return {
    // Same rule as the discount function: a missing flag means enabled.
    enabled: snapshot?.enabled !== false,
    program: snapshot?.program ?? null,
  };
}

const CUSTOMER_QUERY = `#graphql
  query LoyaltyCustomer($id: ID!) {
    customer(id: $id) {
      id
      amountSpent {
        amount
        currencyCode
      }
      numberOfOrders
      balance: metafield(namespace: "$app", key: "loyalty_points_balance") {
        value
        compareDigest
      }
      state: metafield(namespace: "$app", key: "loyalty_state") {
        value
      }
      activeRedemption: metafield(namespace: "$app", key: "loyalty_active_redemption") {
        value
      }
      referredBy: metafield(namespace: "$app", key: "loyalty_referred_by") {
        value
      }
      referredByCredited: metafield(namespace: "$app", key: "loyalty_referred_by_credited") {
        value
      }
    }
  }
` as const;

type CustomerQueryData = {
  customer: {
    id: string;
    amountSpent: {amount: string; currencyCode: string} | null;
    numberOfOrders: number | string | null;
    balance: {value: string | null; compareDigest: string} | null;
    state: {value: string | null} | null;
    activeRedemption: {value: string | null} | null;
    referredBy: {value: string | null} | null;
    referredByCredited: {value: string | null} | null;
  } | null;
};

/**
 * Read everything about one customer that a points change needs, in one call.
 * Throws if Shopify can't be read, so webhooks return 500 and get retried
 * instead of writing a balance computed from nothing (bug 1).
 */
export async function loadLoyaltyCustomer(
  admin: AdminApiContext,
  customerAdminId: string,
): Promise<LoyaltyCustomer | null> {
  const {customer} = await adminGraphql<CustomerQueryData>(
    admin,
    CUSTOMER_QUERY,
    {id: customerAdminId},
  );
  if (!customer) return null;

  const balance = Number.parseInt(customer.balance?.value ?? '0', 10);
  const spend = Number.parseFloat(customer.amountSpent?.amount ?? '0');
  const state = parseJson(customer.state?.value) as {awardedRules?: unknown} | null;
  const referredBy = parseJson(customer.referredBy?.value) as {
    referrerCustomerId?: unknown;
  } | null;

  return {
    id: customer.id,
    balance: Number.isFinite(balance) ? balance : 0,
    balanceDigest: customer.balance?.compareDigest ?? null,
    awardedRules: Array.isArray(state?.awardedRules)
      ? state.awardedRules.filter((rule): rule is string => typeof rule === 'string')
      : [],
    activeRedemption: parseActiveRedemption(customer.activeRedemption?.value),
    referrerId:
      typeof referredBy?.referrerCustomerId === 'string'
        ? referredBy.referrerCustomerId
        : null,
    referralCredited: customer.referredByCredited?.value === 'true',
    lifetimeSpend: Number.isFinite(spend) ? spend : 0,
    paidOrderCount: Number(customer.numberOfOrders ?? 0),
    currencyCode: customer.amountSpent?.currencyCode ?? 'USD',
  };
}

const ORDER_CUSTOMER_QUERY = `#graphql
  query LoyaltyOrderCustomer($id: ID!) {
    order(id: $id) {
      customer {
        id
      }
    }
  }
` as const;

/**
 * The customer who placed an order (refund payloads don't carry one).
 * ponytail: without the read_all_orders scope Shopify only returns orders from
 * the last 60 days, so a refund on an older order finds no customer and takes
 * no points back. Add the scope if that ever matters.
 */
export async function fetchOrderCustomerId(
  admin: AdminApiContext,
  orderGid: string,
): Promise<string | null> {
  const data = await adminGraphql<{order: {customer: {id: string} | null} | null}>(
    admin,
    ORDER_CUSTOMER_QUERY,
    {id: orderGid},
  );
  return data.order?.customer?.id ?? null;
}

// ----------------------------------------------------------------------------
// Writing: every change to a customer's points goes through one call
// ----------------------------------------------------------------------------

/**
 * Write a customer's new points in one atomic metafieldsSet: their balance and
 * derived state, plus optionally their active reward, the referral-paid flag
 * and the referrer's new balance.
 *
 * Each balance carries the compareDigest read with it, so if anything else
 * changed that balance in between (another webhook, a redemption), Shopify
 * rejects the whole write and the caller fails instead of overwriting it.
 */
export async function saveLoyaltyCustomer(
  admin: AdminApiContext,
  {
    program,
    customer,
    balance,
    awardedRules = customer.awardedRules,
    activeRedemption,
    referralCredited = false,
    referrer,
  }: {
    program: LoyaltyProgramConfig;
    customer: LoyaltyCustomer;
    balance: number;
    awardedRules?: string[];
    /** A reward to store, or null to clear it. Omit to leave it unchanged. */
    activeRedemption?: ActiveRedemption | null;
    referralCredited?: boolean;
    referrer?: {customer: LoyaltyCustomer; balance: number};
  },
) {
  const state = buildCustomerLoyaltyState({
    metrics: {
      lifetimeSpend: customer.lifetimeSpend,
      paidOrderCount: customer.paidOrderCount,
      pointsBalance: balance,
      currencyCode: customer.currencyCode,
    },
    program,
    awardedRules,
  });

  const metafields: Array<Record<string, unknown>> = [
    metafield(customer.id, CUSTOMER_LOYALTY_STATE_KEY, 'json', JSON.stringify(state)),
    balanceMetafield(customer, balance),
  ];
  if (activeRedemption !== undefined) {
    // '{}' clears it: every reader (engine, discount function, storefront)
    // treats a record without a handle as no reward.
    metafields.push(
      metafield(
        customer.id,
        CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
        'json',
        JSON.stringify(activeRedemption ?? {}),
      ),
    );
  }
  if (referralCredited) {
    metafields.push(
      metafield(customer.id, CUSTOMER_LOYALTY_REFERRED_BY_CREDITED_KEY, 'boolean', 'true'),
    );
  }
  if (referrer) {
    metafields.push(balanceMetafield(referrer.customer, referrer.balance));
  }

  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {metafields},
  );
  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to save customer loyalty points',
  );
}

function metafield(ownerId: string, key: string, type: string, value: string) {
  return {ownerId, namespace: APP_METAFIELD_NAMESPACE, key, type, value};
}

function balanceMetafield(customer: LoyaltyCustomer, balance: number) {
  return {
    ...metafield(
      customer.id,
      CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
      'number_integer',
      String(Math.max(0, balance)),
    ),
    // null means "must not exist yet", which guards the first write too.
    compareDigest: customer.balanceDigest,
  };
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function parseActiveRedemption(value: string | null | undefined): ActiveRedemption | null {
  const record = parseJson(value) as Record<string, unknown> | null;
  if (
    !record ||
    typeof record.handle !== 'string' ||
    typeof record.rewardType !== 'string' ||
    typeof record.expiresAt !== 'string' ||
    typeof record.redeemedAt !== 'string' ||
    typeof record.pointsCost !== 'number'
  ) {
    return null;
  }
  return {
    handle: record.handle,
    rewardType: record.rewardType,
    rewardValue: typeof record.rewardValue === 'string' ? record.rewardValue : null,
    pointsCost: record.pointsCost,
    expiresAt: record.expiresAt,
    redemptionId: typeof record.redemptionId === 'string' ? record.redemptionId : null,
    redeemedAt: record.redeemedAt,
  };
}

// ----------------------------------------------------------------------------
// Referral attribution
// ----------------------------------------------------------------------------

const CUSTOMER_REFERRAL_ATTRIBUTION_QUERY = `#graphql
  query LoyaltyCustomerReferralAttribution($refereeId: ID!, $referrerId: ID!) {
    referee: customer(id: $refereeId) {
      id
      referredBy: metafield(namespace: "$app", key: "loyalty_referred_by") {
        value
      }
    }
    referrer: customer(id: $referrerId) {
      id
    }
  }
` as const;

type CustomerReferralAttributionData = {
  referee: {
    id: string;
    referredBy: {value: string | null} | null;
  } | null;
  referrer: {
    id: string;
  } | null;
};

export class ReferralAttributionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'ReferralAttributionError';
  }
}

export type ReferralAttribution = {
  referrerCustomerId: string;
  attributedAt: string;
};

/**
 * Attribute a referee customer to a referrer:
 *  - Reject self-referrals (refereeId === referrerId).
 *  - Verify both customers exist in Shopify.
 *  - Refuse if the referee already has a referred_by metafield (one-shot;
 *    first attribution wins; prevents post-signup hijacking).
 *  - Write the referee's loyalty_referred_by metafield as JSON.
 *
 * The actual point award fires later, on the referee's first paid order
 * (see projectPaidOrder).
 */
export async function attributeReferralForCustomer({
  admin,
  refereeId,
  referrerId,
}: {
  admin: AdminApiContext;
  refereeId: string;
  referrerId: string;
}): Promise<ReferralAttribution> {
  if (refereeId === referrerId) {
    throw new ReferralAttributionError(
      'A customer cannot refer themselves.',
      400,
    );
  }

  const data = await adminGraphql<CustomerReferralAttributionData>(
    admin,
    CUSTOMER_REFERRAL_ATTRIBUTION_QUERY,
    {refereeId, referrerId},
  );

  if (!data.referee) {
    throw new ReferralAttributionError('Referee customer not found.', 404);
  }
  if (!data.referrer) {
    throw new ReferralAttributionError('Referrer customer not found.', 404);
  }
  if (data.referee.referredBy?.value) {
    throw new ReferralAttributionError(
      'Customer is already attributed to a referrer.',
      409,
    );
  }

  const attribution: ReferralAttribution = {
    referrerCustomerId: referrerId,
    attributedAt: new Date().toISOString(),
  };

  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: refereeId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_REFERRED_BY_KEY,
          type: 'json',
          value: JSON.stringify(attribution),
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to attribute referral',
  );

  return attribution;
}

// ----------------------------------------------------------------------------
// Manual awards (Customers page)
// ----------------------------------------------------------------------------

/**
 * Manually award an earn rule's points to a single customer (Customers page).
 * Only active, manual-eligible rules (not order/signup/referral) can be awarded.
 * One-time rules are idempotent via the awardedRules ledger; repeatable rules
 * can be awarded repeatedly.
 */
export async function awardEarnRuleToCustomer({
  admin,
  customerAdminId,
  ruleHandle,
  program,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  ruleHandle: string;
  program: LoyaltyProgramConfig;
}): Promise<{
  status: 'awarded' | 'already_awarded' | 'rejected';
  message: string;
}> {
  const rule = program.earnRules.find(
    (entry) => entry.handle === ruleHandle && entry.active,
  );
  if (!rule) {
    return {
      status: 'rejected',
      message: `No active earn rule "${ruleHandle}" exists in the program.`,
    };
  }
  if (!isManualEarnEligible(rule.action)) {
    return {
      status: 'rejected',
      message: `"${rule.title}" (${rule.action}) is awarded automatically and cannot be granted manually.`,
    };
  }

  try {
    const customer = await loadLoyaltyCustomer(admin, customerAdminId);
    if (!customer) {
      return {status: 'rejected', message: 'Customer not found.'};
    }
    const manualRule: ManualAwardRule = {
      handle: rule.handle,
      action: rule.action,
      pointsValue: rule.pointsValue,
      active: rule.active,
      repeatable: rule.repeatable,
    };
    const projection = projectManualAward({
      rule: manualRule,
      currentBalance: customer.balance,
      awardedRules: customer.awardedRules,
    });

    if (projection.status === 'already_awarded') {
      return {
        status: 'already_awarded',
        message: `"${rule.title}" was already awarded to this customer.`,
      };
    }
    if (projection.status === 'rejected') {
      return {
        status: 'rejected',
        message: projection.reason ?? `"${rule.title}" cannot be awarded.`,
      };
    }

    await saveLoyaltyCustomer(admin, {
      program,
      customer,
      balance: projection.newBalance,
      awardedRules: projection.newAwardedRules,
    });

    return {
      status: 'awarded',
      message: `Awarded ${projection.pointsAwarded} points for "${rule.title}".`,
    };
  } catch (error) {
    console.error(error);
    return {
      status: 'rejected',
      message: 'Could not award points right now. Please try again.',
    };
  }
}
