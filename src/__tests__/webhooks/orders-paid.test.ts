import {describe, it, expect} from 'vitest';
import {
  getOrdersPaidCustomerAdminId,
  getOrdersPaidOrderGid,
  getOrdersPaidOrderAmount,
} from '../../webhooks/orders-paid.js';
import type {OrdersPaidWebhookPayload} from '../../webhooks/orders-paid.js';

describe('getOrdersPaidCustomerAdminId', () => {
  it('prefers admin_graphql_api_customer_id', () => {
    const payload: OrdersPaidWebhookPayload = {
      admin_graphql_api_customer_id: 'gid://shopify/Customer/1',
      customer: {id: 99},
    };
    expect(getOrdersPaidCustomerAdminId(payload)).toBe('gid://shopify/Customer/1');
  });

  it('falls back to customer.id', () => {
    expect(getOrdersPaidCustomerAdminId({customer: {id: 42}})).toBe('gid://shopify/Customer/42');
  });

  it('returns null when both are absent', () => {
    expect(getOrdersPaidCustomerAdminId({})).toBeNull();
  });
});

describe('getOrdersPaidOrderGid', () => {
  it('prefers admin_graphql_api_id', () => {
    const payload: OrdersPaidWebhookPayload = {
      admin_graphql_api_id: 'gid://shopify/Order/100',
      id: 999,
    };
    expect(getOrdersPaidOrderGid(payload)).toBe('gid://shopify/Order/100');
  });

  it('falls back to id', () => {
    expect(getOrdersPaidOrderGid({id: 55})).toBe('gid://shopify/Order/55');
  });

  it('returns null when both are absent', () => {
    expect(getOrdersPaidOrderGid({})).toBeNull();
  });
});

describe('getOrdersPaidOrderAmount', () => {
  it('parses a valid price string', () => {
    expect(getOrdersPaidOrderAmount({current_total_price: '149.99'})).toBe(149.99);
  });

  it('returns 0 for missing price', () => {
    expect(getOrdersPaidOrderAmount({})).toBe(0);
  });

  it('returns 0 for negative price', () => {
    expect(getOrdersPaidOrderAmount({current_total_price: '-10'})).toBe(0);
  });

  it('returns 0 for non-numeric string', () => {
    expect(getOrdersPaidOrderAmount({current_total_price: 'free'})).toBe(0);
  });

  it('returns 0 for zero', () => {
    expect(getOrdersPaidOrderAmount({current_total_price: '0.00'})).toBe(0);
  });
});
