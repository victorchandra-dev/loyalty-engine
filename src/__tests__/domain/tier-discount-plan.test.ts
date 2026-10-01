import {describe, it, expect} from 'vitest';
import {buildTierDiscountPlan} from '../../domain/discount-engine.js';
import type {LoyaltyProgramConfig} from '../../domain/program.js';

const tier = (handle: string, name: string, minimumValue: number, order: number) => ({
  id: handle, handle, name, metric: 'lifetime_spend' as const, minimumValue, order,
});
const percentOff = (tierHandle: string, value: number, active = true) => ({
  id: `${tierHandle}-benefit`, handle: `${tierHandle}-benefit`, tierHandle, name: `${value}% off`,
  type: 'discount_percentage' as const, value, displayLabel: `${value}% off`, description: null, active, metadata: null,
});

const program = (overrides: Partial<LoyaltyProgramConfig> = {}): LoyaltyProgramConfig => ({
  currencyCode: 'USD',
  tiers: [tier('bronze', 'Bronze', 300, 0), tier('silver', 'Silver', 700, 1), tier('gold', 'Gold', 1500, 2)],
  benefits: [percentOff('bronze', 5), percentOff('silver', 10), percentOff('gold', 15)],
  earnRules: [],
  redemptions: [],
  ...overrides,
});

describe('buildTierDiscountPlan', () => {
  it('gives each discount tier its own spend range, so a customer only ever matches one', () => {
    expect(buildTierDiscountPlan(program()).map((d) => [d.tierHandle, d.segmentQuery])).toEqual([
      ['bronze', 'amount_spent >= 300 AND amount_spent < 700'],
      ['silver', 'amount_spent >= 700 AND amount_spent < 1500'],
      ['gold', 'amount_spent >= 1500'],
    ]);
  });

  it('carries the percentage and a customer-facing title', () => {
    expect(buildTierDiscountPlan(program())[1]).toMatchObject({
      tierHandle: 'silver',
      percentage: 10,
      title: 'Silver – 10% off',
    });
  });

  it('skips tiers without an active percentage benefit, and the next discount tier starts the range', () => {
    const plan = buildTierDiscountPlan(
      program({benefits: [percentOff('bronze', 5), percentOff('silver', 10, false), percentOff('gold', 15)]}),
    );

    expect(plan.map((d) => [d.tierHandle, d.segmentQuery])).toEqual([
      ['bronze', 'amount_spent >= 300 AND amount_spent < 1500'],
      ['gold', 'amount_spent >= 1500'],
    ]);
  });

  it('is empty when no tier gives a discount', () => {
    expect(buildTierDiscountPlan(program({benefits: []}))).toEqual([]);
  });
});
