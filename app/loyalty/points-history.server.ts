import type {Prisma} from '@prisma/client';
import {prisma} from '../session-storage.server';

export type PointsEventType =
  | 'order'
  | 'signup'
  | 'referral'
  | 'refund'
  | 'redeem'
  | 'reward_used'
  | 'manual';

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
