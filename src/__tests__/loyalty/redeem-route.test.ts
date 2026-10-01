import {describe, it, expect, vi} from 'vitest';
import {customerResponse, fakeAdmin, field, memoryPrisma, okWrite, snapshotResponse} from '../helpers/fakes.js';

const prisma = memoryPrisma();
vi.mock('../../../app/session-storage.server', () => ({prisma}));

// Admin (embedded) auth path: no shared-secret header, so no customer token.
const authenticateAdmin = vi.fn();
vi.mock('../../../app/shopify.server', () => ({
  authenticate: {admin: authenticateAdmin},
  unauthenticated: {admin: vi.fn()},
}));

const {action} = await import('../../../app/routes/api.redeem');

function redeem(admin: unknown) {
  authenticateAdmin.mockResolvedValueOnce({admin, session: {shop: 'test.myshopify.com'}});
  return action({
    request: new Request('https://engine.test/api/redeem', {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({customerAdminId: 'gid://shopify/Customer/1', redemptionHandle: 'discount-10'}),
    }),
  } as never);
}

describe('POST /api/redeem', () => {
  const codeCreated = () => ({
    discountCodeBasicCreate: {codeDiscountNode: {id: 'gid://shopify/DiscountCodeNode/77'}, userErrors: []},
  });

  it('creates a single-use code for this customer, then debits the points and stores the reward', async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () => customerResponse({balance: 600, digest: 'd1'}),
      LoyaltyRewardCodeCreate: codeCreated,
      LoyaltyMetafieldsSet: okWrite,
    });

    const response = await redeem(shopify.admin);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ok: true, newBalance: 100, redemption: {handle: 'discount-10', discountId: 'gid://shopify/DiscountCodeNode/77'}});
    expect(body.redemption.code).toMatch(/^LF-[0-9A-F]{10}$/);

    const discount = shopify.calls.find((c) => c.name === 'LoyaltyRewardCodeCreate')!.variables.discount as Record<string, unknown>;
    expect(discount).toMatchObject({
      code: body.redemption.code,
      usageLimit: 1,
      appliesOncePerCustomer: true,
      endsAt: body.redemption.expiresAt,
      context: {customers: {add: ['gid://shopify/Customer/1']}},
      customerGets: {value: {discountAmount: {amount: 10, appliesOnEachItem: false}}, items: {all: true}},
      combinesWith: {orderDiscounts: true},
    });

    const [write] = shopify.writes();
    expect(field(write, 'loyalty_points_balance')).toMatchObject({value: '100', compareDigest: 'd1'});
    expect(JSON.parse(field(write, 'loyalty_active_redemption')?.value as string)).toMatchObject({
      handle: 'discount-10', pointsCost: 500, code: body.redemption.code, discountId: 'gid://shopify/DiscountCodeNode/77',
    });
  });

  it('records the spent points and the reward code in the history', async () => {
    prisma.events.length = 0;
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () => customerResponse({balance: 600}),
      LoyaltyRewardCodeCreate: codeCreated,
      LoyaltyMetafieldsSet: okWrite,
    });

    const body = await (await redeem(shopify.admin)).json();

    expect(prisma.events).toEqual([
      {
        shop: 'test.myshopify.com', customerId: 'gid://shopify/Customer/1', type: 'redeem', points: -500, balance: 100,
        data: {
          handle: 'discount-10', title: '$10 off', code: body.redemption.code,
          discountId: 'gid://shopify/DiscountCodeNode/77', expiresAt: body.redemption.expiresAt,
        },
      },
    ]);
  });

  it("deletes the code again when the points can't be saved, so no one gets a free reward", async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () => customerResponse({balance: 600, digest: 'd1'}),
      LoyaltyRewardCodeCreate: codeCreated,
      LoyaltyMetafieldsSet: () => ({
        metafieldsSet: {metafields: [], userErrors: [{field: ['metafields', '1'], message: 'The resource has been updated since it was loaded.'}]},
      }),
      LoyaltyRewardCodeDelete: ({id}) => ({discountCodeDelete: {deletedCodeDiscountId: id, userErrors: []}}),
    });

    const response = await redeem(shopify.admin);

    expect(response.status).toBe(500);
    expect(shopify.calls.find((c) => c.name === 'LoyaltyRewardCodeDelete')?.variables.id).toBe('gid://shopify/DiscountCodeNode/77');
  });

  it('refuses a second reward while one is waiting, without taking points (bug 8)', async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () =>
        customerResponse({
          balance: 600,
          activeRedemption: {
            handle: 'discount-10', rewardType: 'fixed_discount', rewardValue: '10', pointsCost: 500,
            expiresAt: new Date(Date.now() + 3_600_000).toISOString(), redemptionId: 'd10', redeemedAt: new Date().toISOString(),
          },
        }),
      LoyaltyMetafieldsSet: okWrite,
    });

    const response = await redeem(shopify.admin);

    expect(response.status).toBe(409);
    expect(shopify.writes()).toHaveLength(0);
  });
});
