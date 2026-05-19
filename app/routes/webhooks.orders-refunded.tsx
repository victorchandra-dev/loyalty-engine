import type {ActionFunctionArgs} from 'react-router';
import * as Sentry from '@sentry/node';
import {
  getOrdersRefundedCustomerAdminId,
  getOrdersRefundedAmount,
  getOrdersRefundedOrderGid,
  computeRefundPointsDebit,
} from '../../src/webhooks/orders-refunded.js';
import type {OrdersRefundedWebhookPayload} from '../../src/webhooks/orders-refunded.js';
import {
  fetchCustomerPointsState,
  syncCustomerLoyaltyState,
} from '../loyalty/customer-state.server';
import {fetchLoyaltyProgramConfiguration} from '../loyalty/program.server';
import {authenticate} from '../shopify.server';

export const action = async ({request}: ActionFunctionArgs) => {
  const {payload, shop, topic, session, admin} =
    await authenticate.webhook(request);

  console.warn(`Received ${topic} webhook for ${shop}`);

  if (!session || !admin) {
    return new Response();
  }

  const refundPayload = payload as OrdersRefundedWebhookPayload;
  const customerAdminId = getOrdersRefundedCustomerAdminId(refundPayload);
  const orderGid = getOrdersRefundedOrderGid(refundPayload);

  if (!customerAdminId) {
    return new Response();
  }

  const configuration = await fetchLoyaltyProgramConfiguration(admin);
  if (!configuration.syncPlan.program) {
    return new Response();
  }

  const program = configuration.syncPlan.program;
  const refundedAmount = getOrdersRefundedAmount(refundPayload);

  if (refundedAmount <= 0) {
    // No monetary refund (e.g. restocking-only refund) — nothing to debit.
    return new Response();
  }

  try {
    const currentState = await fetchCustomerPointsState(admin, customerAdminId);

    const debit = computeRefundPointsDebit({
      refundedAmount,
      earnRules: program.earnRules,
    });

    if (debit <= 0) {
      // No active `order` earn rule means no points were awarded, nothing to reverse.
      return new Response();
    }

    const newBalance = Math.max(0, currentState.pointsBalance - debit);

    console.warn(
      `[loyalty] Refund rollback for order ${orderGid ?? 'unknown'}: ` +
        `debit ${debit} pts (refund $${refundedAmount}), ` +
        `balance ${currentState.pointsBalance} → ${newBalance}`,
    );

    await syncCustomerLoyaltyState({
      admin,
      customerAdminId,
      program,
      pointsBalance: newBalance,
      awardedRules: currentState.awardedRules,
      lastOrderId: currentState.lastOrderId ?? undefined,
    });
  } catch (error) {
    console.error('[loyalty] Failed to process refund rollback', error);
    Sentry.captureException(error, {extra: {customerAdminId, orderGid, refundedAmount}});
    // Return 200 so Shopify does not retry — log is the alert signal here.
  }

  return new Response();
};
