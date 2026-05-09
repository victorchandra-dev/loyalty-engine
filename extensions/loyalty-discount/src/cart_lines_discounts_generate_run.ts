import {
  CartInput,
  CartLinesDiscountsGenerateRunResult,
  DiscountClass,
  OrderDiscountSelectionStrategy,
} from '../generated/api';
import {resolveDiscountDecisionFromMetrics} from '../../../src/domain/discount-engine.js';
import type {LoyaltyProgramConfig} from '../../../src/domain/program.js';

const EMPTY_RESULT: CartLinesDiscountsGenerateRunResult = {
  operations: [],
};

type LoyaltyProgramSnapshot = {
  enabled?: boolean;
  program?: LoyaltyProgramConfig | null;
};

/**
 * Per-customer redemption record persisted to the
 * $app.loyalty_active_redemption metafield by the engine when a customer
 * redeems points. Shape:
 *   { handle, rewardType, rewardValue, expiresAt, pointsCost, redemptionId }
 *
 * The function reads it out of the input query and applies the discount when
 * present + unexpired + of a supported type.
 */
type ActiveRedemption = {
  handle: string;
  rewardType: string;
  rewardValue?: string | null;
  expiresAt?: string | null;
};

export function cartLinesDiscountsGenerateRun(
  input: CartInput,
): CartLinesDiscountsGenerateRunResult {
  const hasOrderDiscountClass = input.discount.discountClasses.includes(
    DiscountClass.Order,
  );

  if (!hasOrderDiscountClass) {
    return EMPTY_RESULT;
  }

  const snapshot = getSnapshotFromMetafield(input.shop.metafield?.jsonValue);
  const customer = input.cart.buyerIdentity?.customer;

  // Master kill-switch — Settings page writes `enabled: false` into the
  // snapshot when an admin pauses the program. Treat missing flag as enabled
  // for backwards compatibility with snapshots written before the toggle.
  if (snapshot?.enabled === false) {
    return EMPTY_RESULT;
  }

  const program = snapshot?.program ?? null;

  if (!program || !customer) {
    return EMPTY_RESULT;
  }

  const operations: CartLinesDiscountsGenerateRunResult['operations'] = [];

  // ---- Tier discount (existing behaviour) ----
  const tierDecision = resolveDiscountDecisionFromMetrics({
    program,
    metrics: {
      lifetimeSpend: parseDecimal(customer.amountSpent.amount),
      paidOrderCount: customer.numberOfOrders,
      pointsBalance: 0,
      currencyCode: customer.amountSpent.currencyCode,
    },
  });

  if (tierDecision && tierDecision.percentage > 0) {
    operations.push({
      orderDiscountsAdd: {
        candidates: [
          {
            message: tierDecision.label,
            targets: [{orderSubtotal: {excludedCartLineIds: []}}],
            value: {percentage: {value: tierDecision.percentage}},
          },
        ],
        selectionStrategy: OrderDiscountSelectionStrategy.First,
      },
    });
  }

  // ---- Redemption discount (new) ----
  // The generated CartInput type may not yet include activeRedemption until
  // `npm run typegen` is re-run after the input query change. Read it via an
  // untyped path so this compiles either way.
  const customerNode = customer as unknown as {
    activeRedemption?: {jsonValue?: unknown} | null;
  };
  const redemption = parseActiveRedemption(
    customerNode.activeRedemption?.jsonValue,
  );

  if (redemption && !isExpired(redemption.expiresAt)) {
    const candidate = buildRedemptionCandidate(redemption);
    if (candidate) {
      operations.push({
        orderDiscountsAdd: {
          candidates: [candidate],
          selectionStrategy: OrderDiscountSelectionStrategy.First,
        },
      });
    }
  }

  if (operations.length === 0) {
    return EMPTY_RESULT;
  }

  return {operations};
}

function buildRedemptionCandidate(redemption: ActiveRedemption) {
  const value = redemptionValue(redemption);
  if (!value) return null;
  return {
    message: redemptionMessage(redemption),
    targets: [{orderSubtotal: {excludedCartLineIds: []}}],
    value,
  };
}

function redemptionValue(redemption: ActiveRedemption) {
  const numericValue = redemption.rewardValue
    ? Number.parseFloat(redemption.rewardValue)
    : null;

  switch (redemption.rewardType) {
    case 'fixed_discount':
      if (numericValue === null || !Number.isFinite(numericValue) || numericValue <= 0) {
        return null;
      }
      return {fixedAmount: {amount: numericValue}};
    case 'percent_discount':
      if (numericValue === null || !Number.isFinite(numericValue) || numericValue <= 0) {
        return null;
      }
      // Cap at 100 defensively
      return {percentage: {value: Math.min(100, numericValue)}};
    case 'free_shipping':
    case 'free_product':
    case 'early_access':
    default:
      // free_shipping needs the cart.delivery-options target wired up first
      // (toml registration + a separate function entrypoint). free_product +
      // early_access are storefront-only metadata for now.
      return null;
  }
}

function redemptionMessage(redemption: ActiveRedemption) {
  if (redemption.rewardType === 'fixed_discount' && redemption.rewardValue) {
    return `Reward redeemed: $${redemption.rewardValue} off`;
  }
  if (redemption.rewardType === 'percent_discount' && redemption.rewardValue) {
    return `Reward redeemed: ${redemption.rewardValue}% off`;
  }
  return 'Loyalty reward redeemed';
}

function parseActiveRedemption(value: unknown): ActiveRedemption | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const handle = typeof record.handle === 'string' ? record.handle : null;
  const rewardType =
    typeof record.rewardType === 'string' ? record.rewardType : null;
  if (!handle || !rewardType) return null;

  return {
    handle,
    rewardType,
    rewardValue:
      typeof record.rewardValue === 'string' ? record.rewardValue : null,
    expiresAt:
      typeof record.expiresAt === 'string' ? record.expiresAt : null,
  };
}

function isExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry)) return false;
  // Function runtime doesn't expose the system clock; Shopify provides Date.
  return Date.now() > expiry;
}

function getSnapshotFromMetafield(value: unknown): LoyaltyProgramSnapshot | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return value as LoyaltyProgramSnapshot;
}

function parseDecimal(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
