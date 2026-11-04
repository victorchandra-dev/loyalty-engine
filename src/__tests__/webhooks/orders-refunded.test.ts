import {describe, it, expect} from 'vitest';
import {
  getOrdersRefundedAmount,
  getOrdersRefundedOrderGid,
  getRefundGid,
  computeRefundPointsDebit,
} from '../../webhooks/orders-refunded.js';
import type {OrdersRefundedWebhookPayload} from '../../webhooks/orders-refunded.js';
import type {LoyaltyEarnRuleConfig} from '../../domain/program.js';

// Shaped like Shopify's refunds/create sample payload: the refund itself, with
// order_id and top-level transactions. It carries no customer and no refunds[].
// IDs are realistic 13-digit ones; the docs sample uses 18-digit IDs, which
// lose precision as JS numbers (real order IDs are far below 2^53).
const shopifyRefundsCreatePayload: OrdersRefundedWebhookPayload = {
  id: 1088818604789,
  order_id: 6209829119461,
  admin_graphql_api_id: 'gid://shopify/Refund/1088818604789',
  transactions: [
    {amount: '41.94', kind: 'refund', status: 'success'},
  ],
};

describe('refunds/create payload', () => {
  it('reads the refunded amount from the top-level transactions', () => {
    expect(getOrdersRefundedAmount(shopifyRefundsCreatePayload)).toBe(41.94);
  });

  it('builds the order GID from order_id', () => {
    expect(getOrdersRefundedOrderGid(shopifyRefundsCreatePayload)).toBe(
      'gid://shopify/Order/6209829119461',
    );
  });

  it('uses the refund GID as the duplicate key', () => {
    expect(getRefundGid(shopifyRefundsCreatePayload)).toBe(
      'gid://shopify/Refund/1088818604789',
    );
    expect(getRefundGid({id: 7})).toBe('gid://shopify/Refund/7');
  });
});

const rule = (pointsValue: number | null, active = true): LoyaltyEarnRuleConfig => ({
  id: 'order',
  handle: 'order',
  title: 'Order',
  description: null,
  action: 'order',
  pointsValue,
  active,
  repeatable: false,
});

describe('getOrdersRefundedAmount', () => {
  it('sums multiple refund transactions', () => {
    const payload: OrdersRefundedWebhookPayload = {
      transactions: [
        {amount: '30.00', kind: 'refund', status: 'success'},
        {amount: '20.00', kind: 'refund', status: 'success'},
      ],
    };
    expect(getOrdersRefundedAmount(payload)).toBe(50);
  });

  it('skips non-refund transaction kinds', () => {
    const payload: OrdersRefundedWebhookPayload = {
      transactions: [{amount: '100.00', kind: 'sale', status: 'success'}],
    };
    expect(getOrdersRefundedAmount(payload)).toBe(0);
  });

  it('skips failed transactions', () => {
    const payload: OrdersRefundedWebhookPayload = {
      transactions: [{amount: '100.00', kind: 'refund', status: 'failure'}],
    };
    expect(getOrdersRefundedAmount(payload)).toBe(0);
  });

  it('returns 0 when there are no transactions', () => {
    expect(getOrdersRefundedAmount({})).toBe(0);
    expect(getOrdersRefundedAmount({transactions: []})).toBe(0);
  });
});

describe('computeRefundPointsDebit', () => {
  it('mirrors computeOrderPoints for the refunded amount', () => {
    expect(computeRefundPointsDebit({refundedAmount: 100, earnRules: [rule(null)]})).toBe(100);
  });

  it('does not take back flat per-order points (each partial refund would repeat it)', () => {
    expect(computeRefundPointsDebit({refundedAmount: 5, earnRules: [rule(200)]})).toBe(0);
    expect(computeRefundPointsDebit({refundedAmount: 100, earnRules: [rule(null), rule(200)]})).toBe(100);
  });

  it('returns 0 when earn rule is inactive', () => {
    expect(computeRefundPointsDebit({refundedAmount: 100, earnRules: [rule(null, false)]})).toBe(0);
  });

  it('returns 0 when no order earn rule exists', () => {
    expect(computeRefundPointsDebit({refundedAmount: 100, earnRules: []})).toBe(0);
  });
});
