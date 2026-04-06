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
  program?: LoyaltyProgramConfig | null;
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

  const program = getProgramFromSnapshot(input.shop.metafield?.jsonValue);
  const customer = input.cart.buyerIdentity?.customer;

  if (!program || !customer) {
    return EMPTY_RESULT;
  }

  const decision = resolveDiscountDecisionFromMetrics({
    program,
    metrics: {
      lifetimeSpend: parseDecimal(customer.amountSpent.amount),
      paidOrderCount: customer.numberOfOrders,
      pointsBalance: 0,
      currencyCode: customer.amountSpent.currencyCode,
    },
  });

  if (!decision || decision.percentage <= 0) {
    return EMPTY_RESULT;
  }

  return {
    operations: [
      {
        orderDiscountsAdd: {
          candidates: [
            {
              message: decision.label,
              targets: [
                {
                  orderSubtotal: {
                    excludedCartLineIds: [],
                  },
                },
              ],
              value: {
                percentage: {
                  value: decision.percentage,
                },
              },
            },
          ],
          selectionStrategy: OrderDiscountSelectionStrategy.First,
        },
      },
    ],
  };
}

function getProgramFromSnapshot(value: unknown): LoyaltyProgramConfig | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const snapshot = value as LoyaltyProgramSnapshot;

  if (!snapshot.program) {
    return null;
  }

  return snapshot.program;
}

function parseDecimal(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
