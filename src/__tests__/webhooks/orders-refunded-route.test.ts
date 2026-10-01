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

const {action} = await import('../../../app/routes/webhooks.orders-refunded');

// Shaped like a real refunds/create payload: no customer, no refunds[].
const REFUND = {
  id: 1088818604789,
  order_id: 6209829119461,
  admin_graphql_api_id: 'gid://shopify/Refund/1088818604789',
  transactions: [{amount: '41.94', kind: 'refund', status: 'success'}],
};

function deliver(admin: unknown) {
  webhook.mockResolvedValueOnce({payload: REFUND, shop: 'test.myshopify.com', topic: 'REFUNDS_CREATE', session: {}, admin});
  return action({request: new Request('https://engine.test/webhooks/orders-refunded', {method: 'POST'})} as never);
}

const responders = () => ({
  LoyaltyProgramSnapshot: snapshotResponse(),
  LoyaltyOrderCustomer: ({id}: Record<string, unknown>) => ({
    order: id === 'gid://shopify/Order/6209829119461' ? {customer: {id: 'gid://shopify/Customer/1'}} : null,
  }),
  LoyaltyCustomer: () => customerResponse({balance: 100, digest: 'd1'}),
  LoyaltyMetafieldsSet: okWrite,
});

describe('refunds/create webhook', () => {
  beforeEach(() => {
    prisma.keys.clear();
    webhook.mockReset();
  });

  it("takes the refunded points back from the order's customer (bug 4)", async () => {
    const shopify = fakeAdmin(responders());

    expect((await deliver(shopify.admin)).status).toBe(200);
    expect(field(shopify.writes()[0], 'loyalty_points_balance', 'gid://shopify/Customer/1')).toMatchObject({value: '59', compareDigest: 'd1'});
  });

  it('takes the points back once when the refund is delivered twice', async () => {
    const shopify = fakeAdmin(responders());

    await Promise.all([deliver(shopify.admin), deliver(shopify.admin)]);

    expect(shopify.writes()).toHaveLength(1);
  });
});
