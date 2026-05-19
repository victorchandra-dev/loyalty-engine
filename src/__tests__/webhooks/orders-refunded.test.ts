import {describe, it, expect} from 'vitest';
import {
  getOrdersRefundedAmount,
  computeRefundPointsDebit,
} from '../../webhooks/orders-refunded.js';
import type {OrdersRefundedWebhookPayload} from '../../webhooks/orders-refunded.js';
import type {LoyaltyEarnRuleConfig} from '../../domain/program.js';

const rule = (pointsValue: number | null, active = true): LoyaltyEarnRuleConfig => ({
  id: 'order',
  handle: 'order',
  title: 'Order',
  description: null,
  action: 'order',
  pointsValue,
  active,
});

describe('getOrdersRefundedAmount', () => {
  it('returns the refunded transaction amount', () => {
    const payload: OrdersRefundedWebhookPayload = {
      refunds: [{transactions: [{amount: '50.00', kind: 'refund', status: 'success'}]}],
    };
    expect(getOrdersRefundedAmount(payload)).toBe(50);
  });

  it('sums multiple refund transactions', () => {
    const payload: OrdersRefundedWebhookPayload = {
      refunds: [
        {transactions: [{amount: '30.00', kind: 'refund', status: 'success'}]},
        {transactions: [{amount: '20.00', kind: 'refund', status: 'success'}]},
      ],
    };
    expect(getOrdersRefundedAmount(payload)).toBe(50);
  });

  it('skips non-refund transaction kinds', () => {
    const payload: OrdersRefundedWebhookPayload = {
      refunds: [{transactions: [{amount: '100.00', kind: 'sale', status: 'success'}]}],
    };
    expect(getOrdersRefundedAmount(payload)).toBe(0);
  });

  it('skips failed transactions', () => {
    const payload: OrdersRefundedWebhookPayload = {
      refunds: [{transactions: [{amount: '100.00', kind: 'refund', status: 'failure'}]}],
    };
    expect(getOrdersRefundedAmount(payload)).toBe(0);
  });

  it('returns 0 for empty refunds', () => {
    expect(getOrdersRefundedAmount({})).toBe(0);
    expect(getOrdersRefundedAmount({refunds: []})).toBe(0);
  });
});

describe('computeRefundPointsDebit', () => {
  it('mirrors computeOrderPoints for the refunded amount', () => {
    expect(computeRefundPointsDebit({refundedAmount: 100, earnRules: [rule(null)]})).toBe(100);
  });

  it('uses flat pointsValue when set', () => {
    expect(computeRefundPointsDebit({refundedAmount: 100, earnRules: [rule(25)]})).toBe(25);
  });

  it('returns 0 when earn rule is inactive', () => {
    expect(computeRefundPointsDebit({refundedAmount: 100, earnRules: [rule(null, false)]})).toBe(0);
  });

  it('returns 0 when no order earn rule exists', () => {
    expect(computeRefundPointsDebit({refundedAmount: 100, earnRules: []})).toBe(0);
  });
});
