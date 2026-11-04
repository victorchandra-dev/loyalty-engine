import {describe, it, expect, vi, beforeEach} from 'vitest';
import {fakeAdmin} from '../helpers/fakes.js';

const prisma = {
  pointsEvent: {
    deleteMany: vi.fn<(args: unknown) => Promise<{count: number}>>(async () => ({count: 3})),
    updateMany: vi.fn<(args: unknown) => Promise<{count: number}>>(async () => ({count: 1})),
  },
};
const webhook = vi.fn();
const sessionStorage = {
  findSessionsByShop: vi.fn<(shop: string) => Promise<Array<{id: string}>>>(async () => [{id: 's1'}]),
  deleteSessions: vi.fn<(ids: string[]) => Promise<boolean>>(async () => true),
};

vi.mock('../../../app/session-storage.server', () => ({prisma}));
vi.mock('../../../app/shopify.server', () => ({authenticate: {webhook}, sessionStorage}));

const customerRedact = (await import('../../../app/routes/webhooks.customers.redact')).action;
const shopRedact = (await import('../../../app/routes/webhooks.shop.redact')).action;

const SHOP = 'test.myshopify.com';
const CUSTOMER = 'gid://shopify/Customer/7';
const request = () => ({request: new Request('https://engine.test/webhooks', {method: 'POST'})}) as never;

const okDelete = () => ({metafieldsDelete: {deletedMetafields: [], userErrors: []}});

beforeEach(() => vi.clearAllMocks());

describe('customers/redact', () => {
  it('deletes the points history and strips the customer from referrers rows, even with no admin client', async () => {
    webhook.mockResolvedValueOnce({payload: {customer: {id: 7}}, shop: SHOP, topic: 'CUSTOMERS_REDACT', admin: undefined});
    const response = await customerRedact(request());

    expect(response.status).toBe(200);
    expect(prisma.pointsEvent.deleteMany).toHaveBeenCalledWith({where: {shop: SHOP, customerId: CUSTOMER}});
    expect(prisma.pointsEvent.updateMany).toHaveBeenCalledWith({
      where: {shop: SHOP, data: {path: ['refereeId'], equals: CUSTOMER}},
      data: {data: {}},
    });
  });

  it('also deletes the metafields when installed', async () => {
    const shopify = fakeAdmin({LoyaltyMetafieldsDelete: okDelete});
    webhook.mockResolvedValueOnce({payload: {customer: {id: 7}}, shop: SHOP, topic: 'CUSTOMERS_REDACT', admin: shopify.admin});
    expect((await customerRedact(request())).status).toBe(200);
    expect(shopify.calls.map((call) => call.name)).toEqual(['LoyaltyMetafieldsDelete']);
  });

  it('returns 500 so Shopify retries when the delete fails', async () => {
    prisma.pointsEvent.deleteMany.mockRejectedValueOnce(new Error('db down'));
    webhook.mockResolvedValueOnce({payload: {customer: {id: 7}}, shop: SHOP, topic: 'CUSTOMERS_REDACT', admin: undefined});
    expect((await customerRedact(request())).status).toBe(500);
  });
});

describe('shop/redact', () => {
  it('deletes the shop points history and sessions', async () => {
    webhook.mockResolvedValueOnce({shop: SHOP, topic: 'SHOP_REDACT'});
    expect((await shopRedact(request())).status).toBe(200);
    expect(prisma.pointsEvent.deleteMany).toHaveBeenCalledWith({where: {shop: SHOP}});
    expect(sessionStorage.deleteSessions).toHaveBeenCalledWith(['s1']);
  });

  it('returns 500 when the delete fails', async () => {
    prisma.pointsEvent.deleteMany.mockRejectedValueOnce(new Error('db down'));
    webhook.mockResolvedValueOnce({shop: SHOP, topic: 'SHOP_REDACT'});
    expect((await shopRedact(request())).status).toBe(500);
  });
});
