import {describe, it, expect, vi, beforeEach} from 'vitest';
import {customerResponse, fakeAdmin, field, memoryPrisma, okWrite, testProgram} from '../helpers/fakes.js';

const prisma = memoryPrisma();
vi.mock('../../../app/session-storage.server', () => ({prisma}));

const {adjustCustomerPoints} = await import('../../../app/loyalty/customer-state.server');

const base = {
  shop: 'test.myshopify.com',
  customerAdminId: 'gid://shopify/Customer/1',
  program: testProgram,
  staffName: ' Rina ',
  reason: ' damaged parcel ',
  staffUserId: '74839201',
};

describe('adjustCustomerPoints', () => {
  beforeEach(() => {
    prisma.events.length = 0;
  });

  it('adds points, saves the balance and records an adjust row', async () => {
    const shopify = fakeAdmin({LoyaltyCustomer: () => customerResponse({balance: 250}), LoyaltyMetafieldsSet: okWrite});

    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: 500});

    expect(result).toEqual({status: 'adjusted', delta: 500, balance: 750});
    expect(field(shopify.writes()[0], 'loyalty_points_balance')).toMatchObject({value: '750', compareDigest: 'digest-1'});
    expect(prisma.events).toEqual([{
      shop: 'test.myshopify.com', customerId: 'gid://shopify/Customer/1', type: 'adjust', points: 500, balance: 750,
      data: {reason: 'damaged parcel', staffName: 'Rina', staffUserId: '74839201'},
    }]);
  });

  it('refuses to remove more than the balance and writes nothing', async () => {
    const shopify = fakeAdmin({LoyaltyCustomer: () => customerResponse({balance: 300})});

    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: -301});

    expect(result).toEqual({status: 'below_zero', balance: 300});
    expect(shopify.writes()).toEqual([]);
    expect(prisma.events).toEqual([]);
  });

  it.each([
    ['zero points', {delta: 0}],
    ['a fraction', {delta: 1.5}],
    ['no number', {delta: Number.NaN}],
    ['a blank name', {staffName: '  '}],
    ['a blank reason', {reason: ''}],
    ['a long name', {staffName: 'x'.repeat(61)}],
    ['a long reason', {reason: 'x'.repeat(201)}],
  ])('rejects %s without calling Shopify', async (_label, overrides) => {
    const shopify = fakeAdmin({});
    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: 10, ...overrides});
    expect(result).toEqual({status: 'invalid'});
    expect(shopify.calls).toEqual([]);
  });

  it('reports a conflict when the balance changed since it was read', async () => {
    const shopify = fakeAdmin({
      LoyaltyCustomer: () => customerResponse({balance: 250}),
      LoyaltyMetafieldsSet: () => ({metafieldsSet: {metafields: [], userErrors: [
        {field: ['metafields', '1'], message: 'The metafield has been modified since it was loaded.', code: 'STALE_OBJECT'},
      ]}}),
    });

    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: 10});

    expect(result).toEqual({status: 'conflict'});
    expect(prisma.events).toEqual([]);
  });

  it('reports not_found for an unknown customer', async () => {
    const shopify = fakeAdmin({LoyaltyCustomer: () => ({customer: null})});
    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: 10});
    expect(result).toEqual({status: 'not_found'});
  });

  it('logs and reports failed when Shopify errors', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const shopify = fakeAdmin({LoyaltyCustomer: () => { throw new Error('boom'); }});

    const result = await adjustCustomerPoints({...base, admin: shopify.admin as never, delta: 10});

    expect(result).toEqual({status: 'failed'});
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
