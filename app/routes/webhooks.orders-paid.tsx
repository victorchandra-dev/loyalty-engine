import type {ActionFunctionArgs} from 'react-router';
import * as Sentry from '@sentry/node';
import {
  getOrdersPaidCustomerAdminId,
  getOrdersPaidOrderAmount,
  getOrdersPaidOrderGid,
} from '../../src/webhooks/orders-paid.js';
import type {OrdersPaidWebhookPayload} from '../../src/webhooks/orders-paid.js';
import {getOneShotEarnPoints} from '../../src/domain/program.js';
import {
  creditReferrerForFirstPaidOrder,
  fetchCustomerPointsState,
  markRefereeReferralCredited,
  projectPointsAwardForOrder,
  syncCustomerLoyaltyState,
} from '../loyalty/customer-state.server';
import {fetchLoyaltyProgramConfiguration} from '../loyalty/program.server';
import {fetchProgramEnabled} from '../loyalty/settings.server';
import {authenticate} from '../shopify.server';

export const action = async ({request}: ActionFunctionArgs) => {
  const {payload, shop, topic, session, admin} =
    await authenticate.webhook(request);

  console.warn(`Received ${topic} webhook for ${shop}`);

  if (!session || !admin) {
    return new Response();
  }

  const ordersPaidPayload = payload as OrdersPaidWebhookPayload;
  const customerAdminId = getOrdersPaidCustomerAdminId(ordersPaidPayload);
  const orderGid = getOrdersPaidOrderGid(ordersPaidPayload);

  if (!customerAdminId) {
    return new Response();
  }

  const {enabled} = await fetchProgramEnabled(admin);
  if (!enabled) {
    return new Response();
  }

  const configuration = await fetchLoyaltyProgramConfiguration(admin);

  if (!configuration.syncPlan.program) {
    return new Response();
  }

  // Compute points to award for this order. We read the customer's current
  // balance + the awarded one-shot list, then layer on order points + any
  // first-time one-shot awards (signup, etc.). Tier sync runs after using the
  // new balance.
  const program = configuration.syncPlan.program;
  const orderAmount = getOrdersPaidOrderAmount(ordersPaidPayload);

  let pointsBalance = 0;
  const awardedRules: string[] = [];
  let referralCreditNeeded: {
    referrerId: string;
    bonusPoints: number;
  } | null = null;

  try {
    const currentState = await fetchCustomerPointsState(admin, customerAdminId);

    // Idempotency: skip if this exact order was already processed.
    if (orderGid && currentState.lastOrderId === orderGid) {
      console.warn(
        `[loyalty] Skipping duplicate orders/paid for order ${orderGid}`,
      );
      return new Response();
    }

    const projection = projectPointsAwardForOrder({
      orderAmount,
      currentBalance: currentState.pointsBalance,
      signupAwarded: currentState.signupAwarded,
      program,
    });
    pointsBalance = projection.newBalance;
    if (
      currentState.signupAwarded ||
      projection.newlyAwardedOneShots.includes('signup')
    ) {
      awardedRules.push('signup');
    }

    // Referral credit fires on the referee's first eligible paid order. Both
    // referrer and referee earn the `referral` earn rule's points_value
    // (bilateral V1 model). We layer the referee's bonus on top of the
    // projection here, and queue the referrer credit + the "credited" flag
    // for after the sync below.
    if (
      currentState.referredBy &&
      !currentState.referredByCredited &&
      currentState.referredBy.referrerCustomerId !== customerAdminId
    ) {
      const bonus = getOneShotEarnPoints('referral', program.earnRules);
      if (bonus > 0) {
        pointsBalance = Math.max(0, pointsBalance + bonus);
        referralCreditNeeded = {
          referrerId: currentState.referredBy.referrerCustomerId,
          bonusPoints: bonus,
        };
      }
    }
  } catch (error) {
    // If the customer has no metafields yet, GraphQL returns nulls which the
    // helper handles. Anything else we log and fall back to a zero-points
    // sync rather than failing the webhook (Shopify would retry).
    console.error('[loyalty] Failed to project order points', error);
    Sentry.captureException(error, {extra: {customerAdminId, orderGid}});
  }

  try {
    await syncCustomerLoyaltyState({
      admin,
      customerAdminId,
      program,
      pointsBalance,
      awardedRules,
      lastOrderId: orderGid ?? undefined,
    });
  } catch (error) {
    // Log and return 200 so Shopify does not retry. A retry would re-read the
    // pre-write balance and re-award the same points, causing a double credit.
    console.error('[loyalty] Failed to sync customer loyalty state', error);
    Sentry.captureException(error, {extra: {customerAdminId, orderGid}});
    return new Response();
  }

  if (referralCreditNeeded) {
    try {
      await creditReferrerForFirstPaidOrder({
        admin,
        referrerId: referralCreditNeeded.referrerId,
        bonusPoints: referralCreditNeeded.bonusPoints,
      });
      await markRefereeReferralCredited({
        admin,
        refereeId: customerAdminId,
      });
    } catch (error) {
      // Best-effort: log and let a manual reconciliation pick this up. We
      // don't fail the webhook because the referee's own state is already
      // saved correctly.
      console.error('[loyalty] Failed to credit referral', error);
      Sentry.captureException(error, {extra: {customerAdminId, referralCreditNeeded}});
    }
  }

  return new Response();
};
