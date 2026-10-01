import {describe, it, expect} from 'vitest';
import {
  projectPaidOrder,
  projectRedemption,
  type LoyaltyCustomer,
} from '../../domain/customer-state.js';
import type {LoyaltyProgramConfig} from '../../domain/program.js';

const program: LoyaltyProgramConfig = {
  currencyCode: 'USD',
  tiers: [],
  benefits: [],
  earnRules: [
    {id: 'o', handle: 'order', title: 'Order', description: null, action: 'order', pointsValue: null, active: true, repeatable: true},
    {id: 's', handle: 'signup', title: 'Signup', description: null, action: 'signup', pointsValue: 200, active: true, repeatable: false},
    {id: 'r', handle: 'referral', title: 'Referral', description: null, action: 'referral', pointsValue: 500, active: true, repeatable: false},
  ],
  redemptions: [
    {id: 'd10', handle: 'discount-10', title: '$10 off', description: null, pointsCost: 500, rewardType: 'fixed_discount', rewardValue: '10', active: true},
    {id: 'old', handle: 'retired', title: 'Retired', description: null, pointsCost: 100, rewardType: 'fixed_discount', rewardValue: '5', active: false},
  ],
};

const customer = (overrides: Partial<LoyaltyCustomer> = {}): LoyaltyCustomer => ({
  id: 'gid://shopify/Customer/1',
  balance: 0,
  balanceDigest: null,
  awardedRules: [],
  activeRedemption: null,
  referrerId: null,
  referralCredited: false,
  lifetimeSpend: 0,
  paidOrderCount: 0,
  currencyCode: 'USD',
  ...overrides,
});

const redemption = (redeemedAt: string, expiresAt = '2026-10-02T12:00:00Z') => ({
  code: 'LF-ABC123',
  discountId: 'gid://shopify/DiscountCodeNode/1',
  handle: 'discount-10',
  rewardType: 'fixed_discount',
  rewardValue: '10',
  pointsCost: 500,
  expiresAt,
  redemptionId: 'd10',
  redeemedAt,
});


describe('projectPaidOrder', () => {
  it('awards order points plus the signup bonus on the first paid order', () => {
    const result = projectPaidOrder({customer: customer(), program, orderAmount: 120.5, discountCodes: []});

    expect(result.balance).toBe(120 + 200);
    expect(result.awardedRules).toEqual(['signup']);
  });

  it('awards only order points once signup was already credited', () => {
    const result = projectPaidOrder({
      customer: customer({balance: 50, awardedRules: ['signup', 'birthday-2026']}),
      program,
      orderAmount: 30,
      discountCodes: [],
    });

    expect(result.balance).toBe(80);
    expect(result.awardedRules).toEqual(['signup', 'birthday-2026']);
  });

  it("gives the referee the referral bonus and returns the referrer's credit", () => {
    const result = projectPaidOrder({
      customer: customer({awardedRules: ['signup'], referrerId: 'gid://shopify/Customer/9'}),
      program,
      orderAmount: 10,
      discountCodes: [],
    });

    expect(result.balance).toBe(10 + 500);
    expect(result.referral).toEqual({referrerId: 'gid://shopify/Customer/9', points: 500});
  });

  it('splits the points into order, signup and referral parts for the history', () => {
    const result = projectPaidOrder({
      customer: customer({balance: 40, awardedRules: [], referrerId: 'gid://shopify/Customer/9'}),
      program,
      orderAmount: 120.5,
      discountCodes: [],
    });

    expect(result.earned).toEqual([
      {type: 'order', points: 120},
      {type: 'signup', points: 200},
      {type: 'referral', points: 500},
    ]);
    expect(40 + result.earned.reduce((sum, part) => sum + part.points, 0)).toBe(result.balance);
  });

  it('leaves zero-point parts out of the breakdown', () => {
    const result = projectPaidOrder({customer: customer({awardedRules: ['signup']}), program, orderAmount: 0.5, discountCodes: []});

    expect(result.earned).toEqual([]);
  });

  it('pays the referral only once', () => {
    const result = projectPaidOrder({
      customer: customer({awardedRules: ['signup'], referrerId: 'gid://shopify/Customer/9', referralCredited: true}),
      program,
      orderAmount: 10,
      discountCodes: [],
    });

    expect(result.balance).toBe(10);
    expect(result.referral).toBeNull();
  });

  it('ignores a self-referral', () => {
    const result = projectPaidOrder({
      customer: customer({awardedRules: ['signup'], referrerId: 'gid://shopify/Customer/1'}),
      program,
      orderAmount: 10,
      discountCodes: [],
    });

    expect(result.referral).toBeNull();
  });

  it('clears the reward when the order used its code', () => {
    const result = projectPaidOrder({
      customer: customer({awardedRules: ['signup'], activeRedemption: redemption('2026-10-01T09:00:00Z')}),
      program,
      orderAmount: 10,
      discountCodes: ['lf-abc123'],
    });

    expect(result.clearRedemption).toBe(true);
  });

  it('keeps the reward when the order used other codes or none', () => {
    const result = projectPaidOrder({
      customer: customer({awardedRules: ['signup'], activeRedemption: redemption('2026-10-01T11:00:00Z')}),
      program,
      orderAmount: 10,
      discountCodes: ['WELCOME10'],
    });

    expect(result.clearRedemption).toBe(false);
  });
});

describe('projectRedemption', () => {
  const now = new Date('2026-10-01T12:00:00Z');

  it('rejects an unknown or inactive reward with 404', () => {
    expect(projectRedemption({customer: customer({balance: 1000}), program, handle: 'retired', now, code: 'LF-NEW'})).toMatchObject({ok: false, status: 404});
    expect(projectRedemption({customer: customer({balance: 1000}), program, handle: 'nope', now, code: 'LF-NEW'})).toMatchObject({ok: false, status: 404});
  });

  it('rejects a second reward while one is still active, keeping the points (409)', () => {
    const result = projectRedemption({
      customer: customer({balance: 1000, activeRedemption: redemption('2026-10-01T11:00:00Z', '2026-10-02T11:00:00Z')}),
      program,
      handle: 'discount-10',
      now,
      code: 'LF-NEW',
    });

    expect(result).toMatchObject({ok: false, status: 409});
  });

  it('allows a new reward once the previous one has expired', () => {
    const result = projectRedemption({
      customer: customer({balance: 1000, activeRedemption: redemption('2026-09-29T11:00:00Z', '2026-09-30T11:00:00Z')}),
      program,
      handle: 'discount-10',
      now,
      code: 'LF-NEW',
    });

    expect(result).toMatchObject({ok: true, balance: 500});
  });

  it('rejects when the balance is too low (400)', () => {
    expect(projectRedemption({customer: customer({balance: 499}), program, handle: 'discount-10', now, code: 'LF-NEW'})).toMatchObject({ok: false, status: 400});
  });

  it('debits the cost and records a reward that expires in 30 days', () => {
    const result = projectRedemption({customer: customer({balance: 600}), program, handle: 'discount-10', now, code: 'LF-NEW'});

    expect(result).toEqual({
      ok: true,
      balance: 100,
      activeRedemption: {
        handle: 'discount-10',
        rewardType: 'fixed_discount',
        rewardValue: '10',
        pointsCost: 500,
        expiresAt: '2026-10-31T12:00:00.000Z',
        redemptionId: 'd10',
        redeemedAt: '2026-10-01T12:00:00.000Z',
        code: 'LF-NEW',
        discountId: null,
      },
    });
  });
});
