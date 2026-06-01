import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import * as Sentry from '@sentry/node';
import {
  CUSTOMER_SPEND_QUERY,
  METAFIELDS_SET_MUTATION,
  METAFIELD_DEFINITION_BY_KEY_QUERY,
  METAFIELD_DEFINITION_CREATE_MUTATION,
  METAFIELD_DEFINITION_UPDATE_MUTATION,
} from '../../src/integrations/shopify/admin-operations.js';
import {buildOrdersPaidSyncPlan} from '../../src/webhooks/orders-paid.js';
import {
  computeOrderPoints,
  getOneShotEarnPoints,
} from '../../src/domain/program.js';
import type {LoyaltyProgramConfig} from '../../src/domain/program.js';
import {projectManualAward, type ManualAwardRule} from '../../src/domain/customer-state.js';
import {
  APP_METAFIELD_NAMESPACE,
  CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
  CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
  CUSTOMER_LOYALTY_REFERRED_BY_CREDITED_KEY,
  CUSTOMER_LOYALTY_REFERRED_BY_KEY,
  CUSTOMER_LOYALTY_STATE_KEY,
  REDEMPTION_TTL_MS,
  isManualEarnEligible,
} from './constants';
import {adminGraphql, assertNoUserErrors} from './graphql.server';

type CustomerSpendQueryData = {
  customer: {
    id: string;
    amountSpent: {
      amount: string;
      currencyCode: string;
    } | null;
    numberOfOrders: number;
  } | null;
};

type MetafieldsSetMutationData = {
  metafieldsSet: {
    userErrors: Array<{
      field?: Array<string | number> | null;
      message: string;
    }>;
  };
};

export async function fetchCustomerSpendMetrics(
  admin: AdminApiContext,
  customerAdminId: string,
) {
  const data = await adminGraphql<CustomerSpendQueryData>(
    admin,
    CUSTOMER_SPEND_QUERY,
    {id: customerAdminId},
  );

  if (!data.customer) {
    return null;
  }

  const parsedLifetimeSpend = Number.parseFloat(
    data.customer.amountSpent?.amount ?? '0',
  );

  return {
    customerAdminId: data.customer.id,
    currencyCode: data.customer.amountSpent?.currencyCode ?? null,
    lifetimeSpend: Number.isFinite(parsedLifetimeSpend)
      ? parsedLifetimeSpend
      : 0,
    numberOfOrders: Number(data.customer.numberOfOrders ?? 0),
  };
}

export async function syncCustomerLoyaltyState({
  admin,
  customerAdminId,
  program,
  pointsBalance = 0,
  awardedRules,
  lastOrderId,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  program: LoyaltyProgramConfig;
  pointsBalance?: number;
  awardedRules?: string[];
  lastOrderId?: string;
}) {
  const metrics = await fetchCustomerSpendMetrics(admin, customerAdminId);

  if (!metrics) {
    return null;
  }

  const plan = await syncCustomerLoyaltyStateFromMetrics({
    admin,
    customerAdminId: metrics.customerAdminId,
    currencyCode: metrics.currencyCode ?? program.currencyCode,
    lifetimeSpend: metrics.lifetimeSpend,
    numberOfOrders: metrics.numberOfOrders,
    pointsBalance,
    awardedRules,
    lastOrderId,
    program,
  });

  return {
    metrics,
    plan,
  };
}

export async function syncCustomerLoyaltyStateFromMetrics({
  admin,
  customerAdminId,
  currencyCode,
  lifetimeSpend,
  numberOfOrders,
  program,
  pointsBalance = 0,
  awardedRules,
  lastOrderId,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  currencyCode: string;
  lifetimeSpend: number;
  numberOfOrders: number;
  program: LoyaltyProgramConfig;
  pointsBalance?: number;
  awardedRules?: string[];
  lastOrderId?: string;
}) {
  const plan = buildOrdersPaidSyncPlan({
    currencyCode,
    customerAdminId,
    lifetimeSpend,
    numberOfOrders,
    pointsBalance,
    awardedRules,
    lastOrderId,
    program,
  });

  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: plan.customerAdminId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_STATE_KEY,
          type: 'json',
          value: plan.loyaltyStateValue,
        },
        {
          ownerId: plan.customerAdminId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
          type: 'number_integer',
          value: String(pointsBalance),
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to sync customer loyalty state',
  );

  return plan;
}

const CUSTOMER_ACCOUNT_READ = 'READ';

/**
 * Customer metafield definitions the loyalty engine owns and must expose to the
 * Customer Account API. The customer-account UI extension reads all three keys
 * (extensions/loyalty-customer-account/src/shared.js) — without a definition
 * granting customerAccount READ for each, the API returns null and the
 * storefront renders 0 points / 0 XP.
 */
const CUSTOMER_METAFIELD_DEFINITIONS: ReadonlyArray<{
  key: string;
  name: string;
  description: string;
  type: string;
}> = [
  {
    key: CUSTOMER_LOYALTY_STATE_KEY,
    name: 'Loyalty State',
    description:
      'Derived loyalty state for the customer. Maintained by the loyalty engine.',
    type: 'json',
  },
  {
    key: CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
    name: 'Loyalty Points Balance',
    description:
      'Customer points balance. Maintained by the loyalty engine.',
    type: 'number_integer',
  },
  {
    key: CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
    name: 'Loyalty Active Redemption',
    description:
      'Active redemption reserved for checkout. Maintained by the loyalty engine.',
    type: 'json',
  },
];

type MetafieldDefinitionByKeyData = {
  metafieldDefinitions: {
    nodes: Array<{
      id: string;
      namespace: string;
      key: string;
      access: {
        customerAccount: string | null;
      } | null;
    }>;
  };
};

type MetafieldDefinitionCreateData = {
  metafieldDefinitionCreate: {
    createdDefinition: {id: string; namespace: string; key: string} | null;
    userErrors: Array<{
      field?: Array<string | number> | null;
      message: string;
      code?: string | null;
    }>;
  };
};

type MetafieldDefinitionUpdateData = {
  metafieldDefinitionUpdate: {
    updatedDefinition: {id: string} | null;
    userErrors: Array<{
      field?: Array<string | number> | null;
      message: string;
      code?: string | null;
    }>;
  };
};

/**
 * Idempotently ensure a single Customer metafield definition exists and grants
 * Customer Account API READ access.
 *
 * Strategy:
 *  - Query for an existing definition with namespace=$app key=<key> on Customer.
 *  - If absent, create it with customerAccount: READ.
 *  - If present but access != READ, run a definition update (no-op when already
 *    READ — keeps repeated bootstraps idempotent).
 */
async function ensureOneCustomerDefinition(
  admin: AdminApiContext,
  def: {key: string; name: string; description: string; type: string},
) {
  const existing = await adminGraphql<MetafieldDefinitionByKeyData>(
    admin,
    METAFIELD_DEFINITION_BY_KEY_QUERY,
    {
      namespace: APP_METAFIELD_NAMESPACE,
      key: def.key,
      ownerType: 'CUSTOMER',
    },
  );

  const definition = existing.metafieldDefinitions.nodes[0];

  if (!definition) {
    const created = await adminGraphql<MetafieldDefinitionCreateData>(
      admin,
      METAFIELD_DEFINITION_CREATE_MUTATION,
      {
        definition: {
          name: def.name,
          description: def.description,
          namespace: APP_METAFIELD_NAMESPACE,
          key: def.key,
          type: def.type,
          ownerType: 'CUSTOMER',
          access: {
            customerAccount: CUSTOMER_ACCOUNT_READ,
          },
        },
      },
    );

    assertNoUserErrors(
      created.metafieldDefinitionCreate.userErrors,
      `Failed to create ${def.key} metafield definition`,
    );

    return;
  }

  if (definition.access?.customerAccount !== CUSTOMER_ACCOUNT_READ) {
    const updated = await adminGraphql<MetafieldDefinitionUpdateData>(
      admin,
      METAFIELD_DEFINITION_UPDATE_MUTATION,
      {
        definition: {
          namespace: APP_METAFIELD_NAMESPACE,
          key: def.key,
          ownerType: 'CUSTOMER',
          access: {
            customerAccount: CUSTOMER_ACCOUNT_READ,
          },
        },
      },
    );

    assertNoUserErrors(
      updated.metafieldDefinitionUpdate.userErrors,
      `Failed to update ${def.key} metafield definition access`,
    );
  }
}

/**
 * Idempotently ensure every Customer metafield definition the loyalty engine
 * exposes to the Customer Account API exists and grants READ access. Without
 * this, the storefront's Customer Account API returns null for those keys and
 * the customer sees 0 points / 0 XP.
 *
 * Runs sequentially per key (volume is small and fixed) so a partial failure
 * surfaces with the offending key in its error.
 */
export async function ensureCustomerLoyaltyStateDefinition(
  admin: AdminApiContext,
) {
  for (const def of CUSTOMER_METAFIELD_DEFINITIONS) {
    await ensureOneCustomerDefinition(admin, def);
  }
}

// ----------------------------------------------------------------------------
// Points awarding
// ----------------------------------------------------------------------------

const CUSTOMER_POINTS_BALANCE_QUERY = `#graphql
  query LoyaltyCustomerPointsBalance($id: ID!) {
    customer(id: $id) {
      id
      pointsBalance: metafield(namespace: "$app", key: "loyalty_points_balance") {
        value
      }
      stateValue: metafield(namespace: "$app", key: "loyalty_state") {
        value
      }
      referredBy: metafield(namespace: "$app", key: "loyalty_referred_by") {
        value
      }
      referredByCredited: metafield(
        namespace: "$app"
        key: "loyalty_referred_by_credited"
      ) {
        value
      }
    }
  }
` as const;

type CustomerPointsBalanceData = {
  customer: {
    id: string;
    pointsBalance: {value: string | null} | null;
    stateValue: {value: string | null} | null;
    referredBy: {value: string | null} | null;
    referredByCredited: {value: string | null} | null;
  } | null;
};

export async function fetchCustomerPointsState(
  admin: AdminApiContext,
  customerAdminId: string,
): Promise<{
  pointsBalance: number;
  signupAwarded: boolean;
  awardedRules: string[];
  lastOrderId: string | null;
  referredBy: ReferralAttribution | null;
  referredByCredited: boolean;
}> {
  const data = await adminGraphql<CustomerPointsBalanceData>(
    admin,
    CUSTOMER_POINTS_BALANCE_QUERY,
    {id: customerAdminId},
  );

  const balance = Number.parseInt(
    data.customer?.pointsBalance?.value ?? '0',
    10,
  );

  let signupAwarded = false;
  let awardedRules: string[] = [];
  let lastOrderId: string | null = null;
  const stateRaw = data.customer?.stateValue?.value;
  if (stateRaw) {
    try {
      const parsed = JSON.parse(stateRaw) as {
        awardedRules?: string[];
        lastOrderId?: string;
      };
      awardedRules = parsed.awardedRules ?? [];
      signupAwarded = awardedRules.includes('signup');
      lastOrderId = parsed.lastOrderId ?? null;
    } catch {
      // ignore parse errors
    }
  }

  let referredBy: ReferralAttribution | null = null;
  const referredByRaw = data.customer?.referredBy?.value;
  if (referredByRaw) {
    try {
      const parsed = JSON.parse(referredByRaw) as Partial<ReferralAttribution>;
      if (parsed?.referrerCustomerId) {
        referredBy = {
          referrerCustomerId: parsed.referrerCustomerId,
          attributedAt: parsed.attributedAt ?? '',
        };
      }
    } catch {
      // ignore parse errors — treat as not attributed
    }
  }

  const referredByCredited = data.customer?.referredByCredited?.value === 'true';

  return {
    pointsBalance: Number.isFinite(balance) ? balance : 0,
    signupAwarded,
    awardedRules,
    lastOrderId,
    referredBy,
    referredByCredited,
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
 * (see syncCustomerLoyaltyStateFromMetrics).
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

/**
 * Credit a referrer for one of their referees' first paid orders. Reads the
 * referrer's current balance, adds the referral bonus, writes it back. Pure
 * append — does not touch any of the referrer's other state.
 *
 * Idempotency lives upstream (the caller flips `referred_by_credited=true`
 * on the referee before/after invoking this so it can't double-fire).
 */
export async function creditReferrerForFirstPaidOrder({
  admin,
  referrerId,
  bonusPoints,
}: {
  admin: AdminApiContext;
  referrerId: string;
  bonusPoints: number;
}): Promise<{newBalance: number; pointsAwarded: number}> {
  if (bonusPoints <= 0) {
    return {newBalance: 0, pointsAwarded: 0};
  }

  const current = await fetchCustomerPointsState(admin, referrerId);
  const newBalance = Math.max(0, current.pointsBalance + bonusPoints);

  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: referrerId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
          type: 'number_integer',
          value: String(newBalance),
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to credit referrer',
  );

  return {newBalance, pointsAwarded: bonusPoints};
}

/**
 * Mark a referee's loyalty_referred_by_credited flag = true so the
 * orders/paid webhook will not re-fire the referral credit on subsequent
 * orders (or after a refund + repurchase).
 */
export async function markRefereeReferralCredited({
  admin,
  refereeId,
}: {
  admin: AdminApiContext;
  refereeId: string;
}): Promise<void> {
  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: refereeId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_REFERRED_BY_CREDITED_KEY,
          type: 'boolean',
          value: 'true',
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to mark referral credited',
  );
}

/**
 * Compute the new points balance for a paid order.
 *
 * Adds:
 *  - Points for the `order` earn rule (1pt/$1 by default, or pointsValue)
 *  - Signup bonus (one-shot) if program has a signup rule and the customer
 *    has not yet been credited it.
 *
 * Pure function — no IO. Returns the new balance + which rules were just
 * awarded for the first time so caller can persist the awardedRules list.
 */
export function projectPointsAwardForOrder({
  orderAmount,
  currentBalance,
  signupAwarded,
  program,
}: {
  orderAmount: number;
  currentBalance: number;
  signupAwarded: boolean;
  program: LoyaltyProgramConfig;
}): {
  newBalance: number;
  pointsAwarded: number;
  newlyAwardedOneShots: string[];
} {
  const orderPoints = computeOrderPoints({
    orderAmount,
    earnRules: program.earnRules,
  });

  let oneShotPoints = 0;
  const newlyAwardedOneShots: string[] = [];

  if (!signupAwarded) {
    const signupBonus = getOneShotEarnPoints('signup', program.earnRules);
    if (signupBonus > 0) {
      oneShotPoints += signupBonus;
      newlyAwardedOneShots.push('signup');
    }
  }

  const totalAwarded = orderPoints + oneShotPoints;
  return {
    newBalance: Math.max(0, currentBalance + totalAwarded),
    pointsAwarded: totalAwarded,
    newlyAwardedOneShots,
  };
}

// ----------------------------------------------------------------------------
// Redemption application
// ----------------------------------------------------------------------------

/**
 * The JSON shape the discount function reads from the customer's
 * loyalty_active_redemption metafield. The function only honours fixed_discount
 * and percent_discount; other reward types can be persisted but are filtered
 * out at function-evaluation time.
 */
export type ActiveRedemptionRecord = {
  handle: string;
  rewardType: string;
  rewardValue?: string | null;
  pointsCost: number;
  expiresAt: string;
  redemptionId?: string | null;
  redeemedAt: string;
};

export class RedemptionError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = 'RedemptionError';
  }
}

/**
 * Apply a redemption for a customer:
 *  - Read the program snapshot to find the redemption by handle.
 *  - Read the customer's current points balance.
 *  - Verify balance >= pointsCost; otherwise throw 400.
 *  - Debit the balance and persist both the new balance and the active
 *    redemption record (with a default TTL).
 *
 * Returns the new balance and the redemption record written.
 */
export async function applyRedemptionForCustomer({
  admin,
  customerAdminId,
  redemptionHandle,
  program,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  redemptionHandle: string;
  program: LoyaltyProgramConfig;
}): Promise<{
  newBalance: number;
  redemption: ActiveRedemptionRecord;
}> {
  const redemption = program.redemptions.find(
    (entry) => entry.handle === redemptionHandle && entry.active,
  );
  if (!redemption) {
    throw new RedemptionError(
      `No active redemption with handle "${redemptionHandle}" exists in the program.`,
      404,
    );
  }

  const currentState = await fetchCustomerPointsState(admin, customerAdminId);
  if (currentState.pointsBalance < redemption.pointsCost) {
    throw new RedemptionError(
      `Customer has ${currentState.pointsBalance} points but the redemption requires ${redemption.pointsCost}.`,
      400,
    );
  }

  const now = new Date();
  const record: ActiveRedemptionRecord = {
    handle: redemption.handle,
    rewardType: redemption.rewardType,
    rewardValue: redemption.rewardValue ?? null,
    pointsCost: redemption.pointsCost,
    expiresAt: new Date(now.getTime() + REDEMPTION_TTL_MS).toISOString(),
    redemptionId: redemption.id,
    redeemedAt: now.toISOString(),
  };

  const newBalance = Math.max(0, currentState.pointsBalance - redemption.pointsCost);

  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {
      metafields: [
        {
          ownerId: customerAdminId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
          type: 'number_integer',
          value: String(newBalance),
        },
        {
          ownerId: customerAdminId,
          namespace: APP_METAFIELD_NAMESPACE,
          key: CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
          type: 'json',
          value: JSON.stringify(record),
        },
      ],
    },
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to apply customer redemption',
  );

  return {newBalance, redemption: record};
}

/**
 * Clear an active redemption (e.g. after the discount is applied at checkout
 * or if the customer cancels). Optionally refund the points so a redeem-then-
 * abandon flow doesn't burn the balance — pass `refund: true` for that.
 */
export async function clearRedemptionForCustomer({
  admin,
  customerAdminId,
  refund = false,
}: {
  admin: AdminApiContext;
  customerAdminId: string;
  refund?: boolean;
}) {
  let pointsBalance: number | null = null;

  if (refund) {
    const currentState = await fetchCustomerPointsState(admin, customerAdminId);
    const refundedAmount = await fetchActiveRedemptionPointsCost(
      admin,
      customerAdminId,
    );
    pointsBalance = currentState.pointsBalance + refundedAmount;
  }

  const metafields: Array<Record<string, unknown>> = [
    {
      ownerId: customerAdminId,
      namespace: APP_METAFIELD_NAMESPACE,
      key: CUSTOMER_LOYALTY_ACTIVE_REDEMPTION_KEY,
      type: 'json',
      value: JSON.stringify(null),
    },
  ];

  if (pointsBalance !== null) {
    metafields.push({
      ownerId: customerAdminId,
      namespace: APP_METAFIELD_NAMESPACE,
      key: CUSTOMER_LOYALTY_POINTS_BALANCE_KEY,
      type: 'number_integer',
      value: String(pointsBalance),
    });
  }

  const result = await adminGraphql<MetafieldsSetMutationData>(
    admin,
    METAFIELDS_SET_MUTATION,
    {metafields},
  );

  assertNoUserErrors(
    result.metafieldsSet.userErrors,
    'Failed to clear customer redemption',
  );

  return {pointsBalance};
}

const ACTIVE_REDEMPTION_QUERY = `#graphql
  query LoyaltyCustomerActiveRedemption($id: ID!) {
    customer(id: $id) {
      id
      activeRedemption: metafield(
        namespace: "$app"
        key: "loyalty_active_redemption"
      ) {
        value
      }
    }
  }
` as const;

type ActiveRedemptionQueryData = {
  customer: {
    id: string;
    activeRedemption: {value: string | null} | null;
  } | null;
};

async function fetchActiveRedemptionPointsCost(
  admin: AdminApiContext,
  customerAdminId: string,
): Promise<number> {
  const data = await adminGraphql<ActiveRedemptionQueryData>(
    admin,
    ACTIVE_REDEMPTION_QUERY,
    {id: customerAdminId},
  );
  const raw = data.customer?.activeRedemption?.value;
  if (!raw) return 0;
  try {
    const parsed = JSON.parse(raw) as {pointsCost?: number};
    return typeof parsed.pointsCost === 'number' && Number.isFinite(parsed.pointsCost)
      ? parsed.pointsCost
      : 0;
  } catch {
    return 0;
  }
}

// ----------------------------------------------------------------------------
// Referral reconciliation
// ----------------------------------------------------------------------------

const UNRECONCILED_REFERRALS_QUERY = `#graphql
  query UnreconciledReferrals($first: Int!, $after: String) {
    customers(first: $first, after: $after) {
      nodes {
        id
        referredBy: metafield(namespace: "$app", key: "loyalty_referred_by") {
          value
        }
        referredByCredited: metafield(
          namespace: "$app"
          key: "loyalty_referred_by_credited"
        ) {
          value
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
` as const;

type UnreconciledReferralsData = {
  customers: {
    nodes: Array<{
      id: string;
      referredBy: {value: string | null} | null;
      referredByCredited: {value: string | null} | null;
    }>;
    pageInfo: {hasNextPage: boolean; endCursor: string | null};
  };
};

export type ReconcileReferralsResult = {
  attempted: number;
  succeeded: number;
  failed: Array<{refereeId: string; error: string}>;
};

/**
 * Find customers with a pending referral credit (referredBy set,
 * referredByCredited = false) and re-attempt the credit for each.
 * Caps at 250 customers per run — sufficient for single-merchant scale.
 */
export async function reconcilePendingReferrals(
  admin: AdminApiContext,
  bonusPoints: number,
): Promise<ReconcileReferralsResult> {
  const result: ReconcileReferralsResult = {
    attempted: 0,
    succeeded: 0,
    failed: [],
  };

  let cursor: string | null = null;
  let hasMore = true;

  while (hasMore && result.attempted < 250) {
    const page: UnreconciledReferralsData = await adminGraphql<UnreconciledReferralsData>(
      admin,
      UNRECONCILED_REFERRALS_QUERY,
      {first: 50, ...(cursor ? {after: cursor} : {})},
    );

    for (const node of page.customers.nodes) {
      if (result.attempted >= 250) break;

      const hasPendingReferral =
        node.referredBy?.value &&
        node.referredByCredited?.value !== 'true';

      if (!hasPendingReferral) continue;

      let referrerCustomerId: string | null = null;
      try {
        const parsed = JSON.parse(node.referredBy!.value!) as Partial<ReferralAttribution>;
        referrerCustomerId = parsed.referrerCustomerId ?? null;
      } catch {
        // malformed referredBy — skip
      }

      if (!referrerCustomerId || referrerCustomerId === node.id) continue;

      result.attempted += 1;
      try {
        await creditReferrerForFirstPaidOrder({
          admin,
          referrerId: referrerCustomerId,
          bonusPoints,
        });
        await markRefereeReferralCredited({admin, refereeId: node.id});
        result.succeeded += 1;
      } catch (error) {
        result.failed.push({
          refereeId: node.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    hasMore = page.customers.pageInfo.hasNextPage;
    cursor = page.customers.pageInfo.endCursor;
  }

  return result;
}

/**
 * Manually award an earn rule's points to a single customer (Customers page).
 * Only active, manual-eligible rules (not order/signup/referral) can be awarded.
 * One-time rules are idempotent via the awardedRules ledger; repeatable rules
 * can be awarded repeatedly. Preserves lastOrderId so order idempotency holds.
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
    const current = await fetchCustomerPointsState(admin, customerAdminId);
    const manualRule: ManualAwardRule = {
      handle: rule.handle,
      action: rule.action,
      pointsValue: rule.pointsValue,
      active: rule.active,
      repeatable: rule.repeatable,
    };
    const projection = projectManualAward({
      rule: manualRule,
      currentBalance: current.pointsBalance,
      awardedRules: current.awardedRules,
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

    const synced = await syncCustomerLoyaltyState({
      admin,
      customerAdminId,
      program,
      pointsBalance: projection.newBalance,
      awardedRules: projection.newAwardedRules,
      lastOrderId: current.lastOrderId ?? undefined,
    });

    if (!synced) {
      return {
        status: 'rejected',
        message: 'Customer has no spend metrics yet; cannot award points.',
      };
    }

    return {
      status: 'awarded',
      message: `Awarded ${projection.pointsAwarded} points for "${rule.title}".`,
    };
  } catch (error) {
    Sentry.captureException(error);
    return {
      status: 'rejected',
      message: 'Could not award points right now. Please try again.',
    };
  }
}
