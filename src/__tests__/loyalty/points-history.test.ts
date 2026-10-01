import {describe, it, expect, vi, beforeEach} from 'vitest';
import {memoryPrisma} from '../helpers/fakes.js';

const prisma = memoryPrisma();
vi.mock('../../../app/session-storage.server', () => ({prisma}));

const {recordPointsEvents} = await import('../../../app/loyalty/points-history.server');

describe('recordPointsEvents', () => {
  beforeEach(() => {
    prisma.events.length = 0;
  });

  it('saves each row with the shop', async () => {
    await recordPointsEvents('test.myshopify.com', [
      {customerId: 'gid://shopify/Customer/1', type: 'order', points: 50, balance: 150, orderId: 'gid://shopify/Order/5'},
    ]);

    expect(prisma.events).toEqual([
      {shop: 'test.myshopify.com', customerId: 'gid://shopify/Customer/1', type: 'order', points: 50, balance: 150, orderId: 'gid://shopify/Order/5'},
    ]);
  });

  it("logs instead of throwing when the database is down, so a webhook can't retry and pay twice", async () => {
    prisma.pointsEvent.createMany.mockRejectedValueOnce(new Error('connection refused'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      recordPointsEvents('test.myshopify.com', [
        {customerId: 'gid://shopify/Customer/1', type: 'order', points: 50, balance: 150},
      ]),
    ).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
