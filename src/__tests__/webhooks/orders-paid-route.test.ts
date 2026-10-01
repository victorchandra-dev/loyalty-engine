import {describe, it, expect, vi, beforeEach} from 'vitest';
import {
  customerResponse,
  fakeAdmin,
  field,
  memoryPrisma,
  okWrite,
  snapshotResponse,
} from '../helpers/fakes.js';

const prisma = memoryPrisma();
const webhook = vi.fn();

vi.mock('../../../app/session-storage.server', () => ({prisma}));
vi.mock('../../../app/shopify.server', () => ({authenticate: {webhook}}));

const {action} = await import('../../../app/routes/webhooks.orders-paid');

const ORDER = {
  admin_graphql_api_id: 'gid://shopify/Order/500',
  customer: {id: 1},
  current_total_price: '50.00',
  created_at: '2026-10-01T10:00:00Z',
};

function deliver(admin: unknown, payload: Record<string, unknown> = ORDER) {
  webhook.mockResolvedValueOnce({payload, shop: 'test.myshopify.com', topic: 'ORDERS_PAID', session: {}, admin});
  return action({request: new Request('https://engine.test/webhooks/orders-paid', {method: 'POST'})} as never);
}

describe('orders/paid webhook', () => {
  beforeEach(() => {
    prisma.keys.clear();
    webhook.mockReset();
  });

  it('awards the order points in one write guarded by the balance digest', async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () => customerResponse({balance: 100, digest: 'd1'}),
      LoyaltyMetafieldsSet: okWrite,
    });

    const response = await deliver(shopify.admin);

    expect(response.status).toBe(200);
    expect(shopify.writes()).toHaveLength(1);
    expect(field(shopify.writes()[0], 'loyalty_points_balance')).toMatchObject({value: '150', compareDigest: 'd1'});
  });

  it('returns 500 and writes nothing when reading the customer fails, then the retry awards (bug 1)', async () => {
    const failing = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () => {
        throw new Error('Throttled');
      },
      LoyaltyMetafieldsSet: okWrite,
    });
    expect((await deliver(failing.admin)).status).toBe(500);
    expect(failing.writes()).toHaveLength(0);

    const retry = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () => customerResponse({balance: 100}),
      LoyaltyMetafieldsSet: okWrite,
    });
    expect((await deliver(retry.admin)).status).toBe(200);
    expect(field(retry.writes()[0], 'loyalty_points_balance')).toMatchObject({value: '150'});
  });

  it('awards once when Shopify delivers the same order twice at the same time (bug 3)', async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () => customerResponse({balance: 100}),
      LoyaltyMetafieldsSet: okWrite,
    });

    const responses = await Promise.all([deliver(shopify.admin), deliver(shopify.admin)]);

    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect(shopify.writes()).toHaveLength(1);
  });

  it('returns 500 so Shopify retries when the balance changed since it was read', async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () => customerResponse({balance: 100}),
      LoyaltyMetafieldsSet: () => ({
        metafieldsSet: {metafields: [], userErrors: [{field: ['metafields', '1'], message: 'The resource has been updated since it was loaded.', code: 'STALE_OBJECT'}]},
      }),
    });

    expect((await deliver(shopify.admin)).status).toBe(500);
    expect(prisma.keys.size).toBe(0);
  });

  it("credits the referrer in the same write and marks the referral paid (bug 6)", async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: ({id}) =>
        id === 'gid://shopify/Customer/9'
          ? customerResponse({id: 'gid://shopify/Customer/9', balance: 1000, digest: 'r1'})
          : customerResponse({balance: 0, digest: 'd1', referrerId: 'gid://shopify/Customer/9'}),
      LoyaltyMetafieldsSet: okWrite,
    });

    await deliver(shopify.admin);

    const [write] = shopify.writes();
    expect(shopify.writes()).toHaveLength(1);
    expect(field(write, 'loyalty_points_balance', 'gid://shopify/Customer/1')).toMatchObject({value: String(50 + 500), compareDigest: 'd1'});
    expect(field(write, 'loyalty_referred_by_credited', 'gid://shopify/Customer/1')).toMatchObject({value: 'true'});
    expect(field(write, 'loyalty_points_balance', 'gid://shopify/Customer/9')).toMatchObject({value: '1500', compareDigest: 'r1'});
  });

  it('clears the reward once the order used its code (bug 2)', async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(),
      LoyaltyCustomer: () =>
        customerResponse({
          balance: 100,
          activeRedemption: {
            handle: 'discount-10', rewardType: 'fixed_discount', rewardValue: '10', pointsCost: 500,
            expiresAt: '2026-10-31T09:00:00Z', redemptionId: 'd10', redeemedAt: '2026-10-01T09:00:00Z',
            code: 'LF-ABC123', discountId: 'gid://shopify/DiscountCodeNode/77',
          },
        }),
      LoyaltyMetafieldsSet: okWrite,
    });

    await deliver(shopify.admin, {...ORDER, discount_codes: [{code: 'LF-ABC123', amount: '10.00', type: 'fixed_amount'}]});

    expect(field(shopify.writes()[0], 'loyalty_active_redemption')).toMatchObject({value: '{}'});
  });

  it('does nothing while the program is paused', async () => {
    const shopify = fakeAdmin({
      LoyaltyProgramSnapshot: snapshotResponse(undefined, false),
      LoyaltyCustomer: () => customerResponse(),
      LoyaltyMetafieldsSet: okWrite,
    });

    expect((await deliver(shopify.admin)).status).toBe(200);
    expect(shopify.writes()).toHaveLength(0);
  });
});
