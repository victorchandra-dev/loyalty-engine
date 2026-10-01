import {describe, it, expect} from 'vitest';
import {
  buildCustomerLoyaltyState,
  getQualifiedTiers,
} from '../../domain/customer-state.js';
import type {LoyaltyProgramConfig} from '../../domain/program.js';

const program = (tiers: LoyaltyProgramConfig['tiers'] = []): LoyaltyProgramConfig => ({
  currencyCode: 'USD',
  tiers,
  benefits: [],
  earnRules: [],
  redemptions: [],
});

const metrics = (overrides = {}) => ({
  lifetimeSpend: 0,
  paidOrderCount: 0,
  pointsBalance: 0,
  currencyCode: 'USD',
  ...overrides,
});

describe('buildCustomerLoyaltyState', () => {
  it('sets currentTierHandle to null when no tiers qualify', () => {
    const state = buildCustomerLoyaltyState({metrics: metrics(), program: program()});
    expect(state.currentTierHandle).toBeNull();
  });

  it('selects the highest qualified tier', () => {
    const tiers = [
      {id: 'bronze', handle: 'bronze', name: 'Bronze', metric: 'lifetime_spend' as const, minimumValue: 0, order: 0},
      {id: 'silver', handle: 'silver', name: 'Silver', metric: 'lifetime_spend' as const, minimumValue: 500, order: 1},
    ];
    const state = buildCustomerLoyaltyState({
      metrics: metrics({lifetimeSpend: 600}),
      program: program(tiers),
    });
    expect(state.currentTierHandle).toBe('silver');
  });

  it('deduplicates awardedRules', () => {
    const state = buildCustomerLoyaltyState({
      metrics: metrics(),
      program: program(),
      awardedRules: ['signup', 'signup', 'referral'],
    });
    expect(state.awardedRules).toEqual(['signup', 'referral']);
  });

  it('omits awardedRules when empty', () => {
    const state = buildCustomerLoyaltyState({metrics: metrics(), program: program(), awardedRules: []});
    expect(state.awardedRules).toBeUndefined();
  });

  it('includes a computedAt ISO timestamp', () => {
    const state = buildCustomerLoyaltyState({metrics: metrics(), program: program()});
    expect(new Date(state.computedAt).getTime()).toBeGreaterThan(0);
  });
});

describe('getQualifiedTiers', () => {
  const tiers = [
    {id: 'bronze', handle: 'bronze', name: 'Bronze', metric: 'lifetime_spend' as const, minimumValue: 0, order: 0},
    {id: 'silver', handle: 'silver', name: 'Silver', metric: 'paid_order_count' as const, minimumValue: 5, order: 1},
    {id: 'gold', handle: 'gold', name: 'Gold', metric: 'points_balance' as const, minimumValue: 1000, order: 2},
  ];

  it('qualifies tier at exact minimumValue threshold', () => {
    expect(getQualifiedTiers(program(tiers), metrics({lifetimeSpend: 0})).map((t) => t.handle)).toContain('bronze');
  });

  it('qualifies paid_order_count tier', () => {
    const result = getQualifiedTiers(program(tiers), metrics({paidOrderCount: 5}));
    expect(result.map((t) => t.handle)).toContain('silver');
  });

  it('does not qualify tier below threshold', () => {
    const result = getQualifiedTiers(program(tiers), metrics({paidOrderCount: 4}));
    expect(result.map((t) => t.handle)).not.toContain('silver');
  });

  it('qualifies points_balance tier', () => {
    const result = getQualifiedTiers(program(tiers), metrics({pointsBalance: 1000}));
    expect(result.map((t) => t.handle)).toContain('gold');
  });
});
