import {describe, it, expect} from 'vitest';
import {
  customerResponse,
  fakeAdmin,
  field,
  okWrite,
  snapshotResponse,
  testProgram,
} from '../helpers/fakes.js';

const {backfillCustomerLoyaltyLevels, ensureAutomaticDiscount} = await import(
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

describe('Checkout discount', () => {
  it('is created even when no tier gives a % discount, so redeemed rewards still apply (bug 10)', async () => {
    const shopify = fakeAdmin({
      LoyaltyAutomaticDiscountCreate: () => ({
        discountAutomaticAppCreate: {automaticAppDiscount: {discountId: 'gid://shopify/DiscountAutomaticNode/1'}, userErrors: []},
      }),
    });
    const configuration = {
      currentDiscountId: null,
      syncPlan: {program: testProgram, discountConfiguration: {currencyCode: 'USD', generatedAt: '', tiers: []}},
    };

    const discountId = await ensureAutomaticDiscount(shopify.admin as never, configuration as never);

    expect(discountId).toBe('gid://shopify/DiscountAutomaticNode/1');
  });
});
