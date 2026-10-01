import {describe, it, expect, vi, beforeEach} from 'vitest';

// In-memory stand-in for the ProcessedWebhook table: create() fails with
// Prisma's unique-violation code when the key already exists.
const keys = new Set<string>();
const prisma = {
  processedWebhook: {
    create: vi.fn(async ({data}: {data: {key: string}}) => {
      if (keys.has(data.key)) {
        throw Object.assign(new Error('Unique constraint failed'), {code: 'P2002'});
      }
      keys.add(data.key);
    }),
    delete: vi.fn(async ({where}: {where: {key: string}}) => {
      keys.delete(where.key);
    }),
  },
};

vi.mock('../../../app/session-storage.server', () => ({prisma}));

const {runOnce} = await import('../../../app/loyalty/run-once.server');

describe('runOnce', () => {
  beforeEach(() => keys.clear());

  it('runs the work once when the same key arrives twice at the same time', async () => {
    const work = vi.fn(async () => {});

    const results = await Promise.all([
      runOnce('orders/paid:gid://shopify/Order/1', work),
      runOnce('orders/paid:gid://shopify/Order/1', work),
    ]);

    expect(work).toHaveBeenCalledTimes(1);
    expect(results.sort()).toEqual(['done', 'duplicate']);
  });

  it('releases the key when the work fails, so a retry runs again', async () => {
    const failing = vi.fn(async () => {
      throw new Error('Shopify read failed');
    });
    await expect(runOnce('k', failing)).rejects.toThrow('Shopify read failed');

    const retry = vi.fn(async () => {});
    await expect(runOnce('k', retry)).resolves.toBe('done');
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('rethrows database errors other than a duplicate key', async () => {
    prisma.processedWebhook.create.mockRejectedValueOnce(new Error('db down'));
    const work = vi.fn(async () => {});

    await expect(runOnce('k', work)).rejects.toThrow('db down');
    expect(work).not.toHaveBeenCalled();
  });
});
