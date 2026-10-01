import {describe, it, expect} from 'vitest';
import {
  customerResponse,
  fakeAdmin,
  field,
  okWrite,
  snapshotResponse,
  testProgram,
} from '../helpers/fakes.js';

const {backfillCustomerLoyaltyLevels, syncTierDiscounts} = await import(
  '../../../app/loyalty/admin.server'
);

const page = (ids: string[]) => () => ({
  customers: {nodes: ids.map((id) => ({id})), pageInfo: {hasNextPage: false, endCursor: null}},
});

describe('Sync customers (backfill)', () => {
  it('keeps the balance and every one-time award it read (bug 7)', async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomersPage: page(['gid://shopify/Customer/1']),
      LoyaltyCustomer: () => customerResponse({balance: 300, digest: 'd1', awardedRules: ['signup', 'birthday-2026']}),
      LoyaltyMetafieldsSet: okWrite,
    });

    await backfillCustomerLoyaltyLevels(shopify.admin as never);

    const [write] = shopify.writes();
    expect(field(write, 'loyalty_points_balance')).toMatchObject({value: '300', compareDigest: 'd1'});
    expect(JSON.parse(field(write, 'loyalty_state')?.value as string).awardedRules).toEqual(['signup', 'birthday-2026']);
  });

  it("skips a customer it can't read instead of writing 0 points, and carries on (bug 7)", async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomersPage: page(['gid://shopify/Customer/1', 'gid://shopify/Customer/2']),
      LoyaltyCustomer: ({id}) => {
        if (id === 'gid://shopify/Customer/1') throw new Error('Throttled');
        return customerResponse({id: 'gid://shopify/Customer/2', balance: 80});
      },
      LoyaltyMetafieldsSet: okWrite,
    });

    const result = await backfillCustomerLoyaltyLevels(shopify.admin as never);

    expect(result).toMatchObject({syncedCustomers: 1, failedCustomers: 1});
    expect(shopify.writes()).toHaveLength(1);
    expect(field(shopify.writes()[0], 'loyalty_points_balance', 'gid://shopify/Customer/2')).toMatchObject({value: '80'});
  });
});

describe('Tier discounts (built-in, no Function)', () => {
  // testProgram has tiers but no % benefits; give two tiers a discount.
  const program = {
    ...testProgram,
    tiers: [
      {id: 'b', handle: 'bronze', name: 'Bronze', metric: 'lifetime_spend' as const, minimumValue: 300, order: 0},
      {id: 's', handle: 'silver', name: 'Silver', metric: 'lifetime_spend' as const, minimumValue: 700, order: 1},
    ],
    benefits: [
      {id: 'bb', handle: 'bb', tierHandle: 'bronze', name: '5% off', type: 'discount_percentage' as const, value: 5, displayLabel: '5% off', description: null, active: true, metadata: null},
      {id: 'sb', handle: 'sb', tierHandle: 'silver', name: '10% off', type: 'discount_percentage' as const, value: 10, displayLabel: '10% off', description: null, active: true, metadata: null},
    ],
  };

  const state = (saved: Record<string, unknown> = {}, legacy: string | null = null) => () => ({
    shop: {
      id: 'gid://shopify/Shop/1',
      tierDiscounts: Object.keys(saved).length ? {value: JSON.stringify(saved)} : null,
      legacyDiscount: legacy ? {value: legacy} : null,
    },
  });
  const created = (prefix: string) => {
    let n = 0;
    return () => `gid://shopify/${prefix}/${++n}`;
  };
  const responders = (overrides: Record<string, (v: Record<string, unknown>) => unknown> = {}) => {
    const segmentId = created('Segment');
    const discountId = created('DiscountAutomaticNode');
    return {
      LoyaltyTierDiscountState: state(),
      LoyaltyNodesExist: ({ids}: Record<string, unknown>) => ({nodes: (ids as string[]).map((id) => ({id}))}),
      LoyaltySegmentCreate: () => ({segmentCreate: {segment: {id: segmentId()}, userErrors: []}}),
      LoyaltySegmentUpdate: ({id}: Record<string, unknown>) => ({segmentUpdate: {segment: {id}, userErrors: []}}),
      LoyaltySegmentDelete: ({id}: Record<string, unknown>) => ({segmentDelete: {deletedSegmentId: id, userErrors: []}}),
      LoyaltyTierDiscountCreate: () => ({discountAutomaticBasicCreate: {automaticDiscountNode: {id: discountId()}, userErrors: []}}),
      LoyaltyTierDiscountUpdate: ({id}: Record<string, unknown>) => ({discountAutomaticBasicUpdate: {automaticDiscountNode: {id}, userErrors: []}}),
      LoyaltyAutomaticDiscountDelete: ({id}: Record<string, unknown>) => ({discountAutomaticDelete: {deletedAutomaticDiscountId: id, userErrors: []}}),
      LoyaltyMetafieldsDelete: () => ({metafieldsDelete: {deletedMetafields: [], userErrors: []}}),
      LoyaltyMetafieldsSet: okWrite,
      ...overrides,
    };
  };
  const names = (shopify: ReturnType<typeof fakeAdmin>) => shopify.calls.map((call) => call.name);
  const savedMap = (shopify: ReturnType<typeof fakeAdmin>) =>
    JSON.parse(field(shopify.writes().at(-1)!, 'loyalty_tier_discounts')?.value as string);

  it('creates a segment and a segment-limited automatic discount per discount tier, and saves their IDs', async () => {
    const shopify = fakeAdmin(responders());

    await syncTierDiscounts(shopify.admin as never, program);

    const segments = shopify.calls.filter((c) => c.name === 'LoyaltySegmentCreate').map((c) => c.variables.query);
    expect(segments).toEqual(['amount_spent >= 300 AND amount_spent < 700', 'amount_spent >= 700']);
    const silver = shopify.calls.filter((c) => c.name === 'LoyaltyTierDiscountCreate')[1].variables.discount as Record<string, unknown>;
    expect(silver).toMatchObject({
      title: 'Silver – 10% off',
      customerGets: {value: {percentage: 0.1}, items: {all: true}},
      context: {customerSegments: {add: ['gid://shopify/Segment/2']}},
      combinesWith: {orderDiscounts: true},
    });
    expect(savedMap(shopify)).toEqual({
      bronze: {segmentId: 'gid://shopify/Segment/1', discountId: 'gid://shopify/DiscountAutomaticNode/1'},
      silver: {segmentId: 'gid://shopify/Segment/2', discountId: 'gid://shopify/DiscountAutomaticNode/2'},
    });
  });

  it('updates the saved segment and discount in place when both still exist', async () => {
    const saved = {
      bronze: {segmentId: 'gid://shopify/Segment/10', discountId: 'gid://shopify/DiscountAutomaticNode/10'},
      silver: {segmentId: 'gid://shopify/Segment/20', discountId: 'gid://shopify/DiscountAutomaticNode/20'},
    };
    const shopify = fakeAdmin(responders({LoyaltyTierDiscountState: state(saved)}));

    await syncTierDiscounts(shopify.admin as never, program);

    expect(names(shopify)).not.toContain('LoyaltySegmentCreate');
    expect(names(shopify)).not.toContain('LoyaltyTierDiscountCreate');
    expect(shopify.calls.filter((c) => c.name === 'LoyaltyTierDiscountUpdate').map((c) => c.variables.id)).toEqual([
      'gid://shopify/DiscountAutomaticNode/10',
      'gid://shopify/DiscountAutomaticNode/20',
    ]);
    expect(savedMap(shopify)).toEqual(saved);
  });

  it('recreates a tier whose saved discount was deleted in the admin', async () => {
    const saved = {
      bronze: {segmentId: 'gid://shopify/Segment/10', discountId: 'gid://shopify/DiscountAutomaticNode/10'},
      silver: {segmentId: 'gid://shopify/Segment/20', discountId: 'gid://shopify/DiscountAutomaticNode/20'},
    };
    const shopify = fakeAdmin(responders({
      LoyaltyTierDiscountState: state(saved),
      LoyaltyNodesExist: ({ids}) => ({nodes: (ids as string[]).map((id) => (id.endsWith('DiscountAutomaticNode/10') ? null : {id}))}),
    }));

    await syncTierDiscounts(shopify.admin as never, program);

    // The orphaned segment goes, then bronze gets a fresh pair; silver is untouched.
    expect(shopify.calls.filter((c) => c.name === 'LoyaltySegmentDelete').map((c) => c.variables.id)).toEqual(['gid://shopify/Segment/10']);
    expect(savedMap(shopify).bronze).toEqual({segmentId: 'gid://shopify/Segment/1', discountId: 'gid://shopify/DiscountAutomaticNode/1'});
    expect(savedMap(shopify).silver).toEqual(saved.silver);
  });

  it('removes the discount and segment of a tier that no longer gives a discount', async () => {
    const saved = {retired: {segmentId: 'gid://shopify/Segment/9', discountId: 'gid://shopify/DiscountAutomaticNode/9'}};
    const shopify = fakeAdmin(responders({LoyaltyTierDiscountState: state(saved)}));

    await syncTierDiscounts(shopify.admin as never, program);

    expect(shopify.calls.filter((c) => c.name === 'LoyaltyAutomaticDiscountDelete').map((c) => c.variables.id)).toEqual(['gid://shopify/DiscountAutomaticNode/9']);
    expect(shopify.calls.filter((c) => c.name === 'LoyaltySegmentDelete').map((c) => c.variables.id)).toEqual(['gid://shopify/Segment/9']);
    expect(savedMap(shopify).retired).toBeUndefined();
  });

  it('deletes the old Function discount and its saved ID', async () => {
    const shopify = fakeAdmin(responders({LoyaltyTierDiscountState: state({}, 'gid://shopify/DiscountAutomaticNode/1526144729174')}));

    await syncTierDiscounts(shopify.admin as never, program);

    expect(shopify.calls.filter((c) => c.name === 'LoyaltyAutomaticDiscountDelete').map((c) => c.variables.id)).toContain('gid://shopify/DiscountAutomaticNode/1526144729174');
    expect(names(shopify)).toContain('LoyaltyMetafieldsDelete');
  });
});
