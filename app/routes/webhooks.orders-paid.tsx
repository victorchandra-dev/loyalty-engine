import type {ActionFunctionArgs} from 'react-router';
import {
  getOrdersPaidCustomerAdminId,
  getOrdersPaidOrderAmount,
} from '../../src/webhooks/orders-paid.js';
import type {OrdersPaidWebhookPayload} from '../../src/webhooks/orders-paid.js';
import {
  fetchCustomerPointsState,
  projectPointsAwardForOrder,
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

  const ordersPaidPayload = payload as OrdersPaidWebhookPayload;
  const customerAdminId = getOrdersPaidCustomerAdminId(ordersPaidPayload);

  if (!customerAdminId) {
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

  try {
    const currentState = await fetchCustomerPointsState(admin, customerAdminId);
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
  } catch (error) {
    // If the customer has no metafields yet, GraphQL returns nulls which the
    // helper handles. Anything else we log and fall back to a zero-points
    // sync rather than failing the webhook (Shopify would retry).
    console.error('[loyalty] Failed to project order points', error);
  }

  await syncCustomerLoyaltyState({
    admin,
    customerAdminId,
    program,
    pointsBalance,
    awardedRules,
  });

  return new Response();
};
