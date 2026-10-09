import {describe, it, expect, vi, beforeEach} from 'vitest';
import {memoryPrisma} from '../helpers/fakes.js';

const prisma = memoryPrisma();
vi.mock('../../../app/session-storage.server', () => ({prisma}));

const {recordPointsEvents, historyPageArgs, listPointsEvents, HISTORY_PAGE_SIZE} = await import('../../../app/loyalty/points-history.server');

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

describe('historyPageArgs', () => {
  it('reads the newest rows of one customer in one shop', () => {
    expect(historyPageArgs('test.myshopify.com', 'gid://shopify/Customer/1', null)).toEqual({
      where: {shop: 'test.myshopify.com', customerId: 'gid://shopify/Customer/1'},
      orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
      take: HISTORY_PAGE_SIZE + 1,
    });
  });

  it('continues after the cursor row, still inside the shop and customer', () => {
    const args = historyPageArgs('test.myshopify.com', 'gid://shopify/Customer/1', '2026-10-05T03:00:00.000Z_ck9');
    const at = new Date('2026-10-05T03:00:00.000Z');
    expect(args.where).toEqual({
      shop: 'test.myshopify.com',
      customerId: 'gid://shopify/Customer/1',
      OR: [{createdAt: {lt: at}}, {createdAt: at, id: {lt: 'ck9'}}],
    });
  });

  it('treats a malformed cursor as the first page', () => {
    expect(historyPageArgs('s', 'c', 'garbage').where).toEqual({shop: 's', customerId: 'c'});
    expect(historyPageArgs('s', 'c', 'not-a-date_ck9').where).toEqual({shop: 's', customerId: 'c'});
  });
});

describe('listPointsEvents', () => {
  const rows = (n: number) =>
    Array.from({length: n}, (_, i) => ({id: `ck${100 - i}`, createdAt: new Date(Date.UTC(2026, 9, 5, 0, 0, 100 - i))}));

  it('returns a cursor when there is another page', async () => {
    prisma.pointsEvent.findMany.mockResolvedValueOnce(rows(HISTORY_PAGE_SIZE + 1));
    const page = await listPointsEvents('s', 'c', null);
    expect(page.rows).toHaveLength(HISTORY_PAGE_SIZE);
    const last = page.rows.at(-1) as {id: string; createdAt: Date};
    expect(page.nextCursor).toBe(`${last.createdAt.toISOString()}_${last.id}`);
  });

  it('returns no cursor on the last page', async () => {
    prisma.pointsEvent.findMany.mockResolvedValueOnce(rows(3));
    const page = await listPointsEvents('s', 'c', null);
    expect(page.rows).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });
});
