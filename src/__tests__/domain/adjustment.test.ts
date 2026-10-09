import {describe, it, expect} from 'vitest';
import {projectAdjustment, type LoyaltyCustomer} from '../../domain/customer-state.js';

const customer = (overrides: Partial<LoyaltyCustomer> = {}): LoyaltyCustomer => ({
  id: 'gid://shopify/Customer/1', balance: 300, balanceDigest: 'd', awardedRules: [], activeRedemption: null,
  referrerId: null, referralCredited: false, lifetimeSpend: 250, paidOrderCount: 3, currencyCode: 'USD',
  ...overrides,
});

describe('projectAdjustment', () => {
  it('adds points', () => {
    const r = projectAdjustment({customer: customer(), delta: 500});
    expect(r).toEqual({status: 'adjusted', newBalance: 800});
  });

  it('removes points down to exactly 0', () => {
    const r = projectAdjustment({customer: customer(), delta: -300});
    expect(r).toEqual({status: 'adjusted', newBalance: 0});
  });

  it('refuses to go below 0 and reports the current balance', () => {
    const r = projectAdjustment({customer: customer(), delta: -301});
    expect(r).toEqual({status: 'below_zero', balance: 300});
  });
});
