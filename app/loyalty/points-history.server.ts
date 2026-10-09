import type {PointsEvent, Prisma} from '@prisma/client';
import {prisma} from '../session-storage.server';

export type PointsEventType =
  | 'order'
  | 'signup'
  | 'referral'
  | 'refund'
  | 'redeem'
  | 'reward_used'
  | 'manual'
  | 'adjust';

export type PointsEventInput = {
  customerId: string;
  type: PointsEventType;
  /** The change: +87, -500; 0 for reward_used. */
  points: number;
  /** The balance after this change. */
  balance: number;
  orderId?: string;
  data?: Prisma.InputJsonObject;
};

/**
 * Append rows to the points history. Call only after the balance write
 * succeeded. Never throws: inside a webhook's runOnce, a throw would release
 * the claim and Shopify's retry would award the points again, so a missing
 * history row is the lesser failure. The error is logged so the alert fires.
 */
export async function recordPointsEvents(shop: string, events: PointsEventInput[]) {
  if (events.length === 0) return;
  try {
    await prisma.pointsEvent.createMany({
      data: events.map((event) => ({shop, ...event})),
    });
  } catch (error) {
    console.error(`[loyalty] Could not save points history for ${shop}: ${JSON.stringify(events)}`);
    console.error(error);
  }
}

export const HISTORY_PAGE_SIZE = 25;

/**
 * One page of a customer's history, newest first. The cursor is
 * `<createdAt ISO>_<id>` of the last row shown (keyset paging: the where
 * filter always applies, so a foreign cursor can't leak another customer's rows).
 */
export function historyPageArgs(
  shop: string,
  customerId: string,
  after: string | null,
) {
  const [iso, id] = after?.split('_') ?? [];
  const at = new Date(iso ?? '');
  const cursor = id && !Number.isNaN(at.getTime()) ? {at, id} : null;
  return {
    where: {
      shop,
      customerId,
      ...(cursor
        ? {OR: [{createdAt: {lt: cursor.at}}, {createdAt: cursor.at, id: {lt: cursor.id}}]}
        : {}),
    },
    orderBy: [{createdAt: 'desc'}, {id: 'desc'}],
    take: HISTORY_PAGE_SIZE + 1,
  } satisfies Prisma.PointsEventFindManyArgs;
}

export async function listPointsEvents(
  shop: string,
  customerId: string,
  after: string | null,
): Promise<{rows: PointsEvent[]; nextCursor: string | null}> {
  const found = await prisma.pointsEvent.findMany(historyPageArgs(shop, customerId, after));
  const rows = found.slice(0, HISTORY_PAGE_SIZE);
  const last = rows.at(-1);
  return {
    rows,
    nextCursor: found.length > HISTORY_PAGE_SIZE && last ? `${last.createdAt.toISOString()}_${last.id}` : null,
  };
}
