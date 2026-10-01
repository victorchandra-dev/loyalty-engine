import {prisma} from '../session-storage.server';

/**
 * Run `work` at most once per `key` (e.g. `orders/paid:<order GID>`).
 *
 * The key is claimed with an insert before any work happens, so two deliveries
 * of the same webhook arriving at once can't both award points: the second
 * insert hits the primary key and returns 'duplicate'. If the work throws, the
 * claim is released and the error rethrown, so the caller returns 500 and
 * Shopify's retry runs the work again.
 *
 * ponytail: a crash between the claim and the write loses that one event
 * (the retry sees the claim). Rare enough to accept; a status column would
 * close it.
 */
export async function runOnce(
  key: string,
  work: () => Promise<void>,
): Promise<'done' | 'duplicate'> {
  try {
    await prisma.processedWebhook.create({data: {key}});
  } catch (error) {
    if ((error as {code?: string}).code === 'P2002') return 'duplicate';
    throw error;
  }

  try {
    await work();
    return 'done';
  } catch (error) {
    await prisma.processedWebhook.delete({where: {key}}).catch(() => {});
    throw error;
  }
}
