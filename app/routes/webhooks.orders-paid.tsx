import type {ActionFunctionArgs} from 'react-router';
import {getOrdersPaidCustomerAdminId} from '../../src/webhooks/orders-paid.js';
import type {OrdersPaidWebhookPayload} from '../../src/webhooks/orders-paid.js';
import {syncCustomerLoyaltyState} from '../loyalty/customer-state.server';
import {fetchLoyaltyProgramConfiguration} from '../loyalty/program.server';
import {authenticate} from '../shopify.server';

export const action = async ({request}: ActionFunctionArgs) => {
  const {payload, shop, topic, session, admin} =
    await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  if (!session || !admin) {
    return new Response();
  }

  const customerAdminId = getOrdersPaidCustomerAdminId(
    payload as OrdersPaidWebhookPayload,
  );

  if (!customerAdminId) {
    return new Response();
  }

  const configuration = await fetchLoyaltyProgramConfiguration(admin);

  if (!configuration.syncPlan.program) {
    return new Response();
  }

  await syncCustomerLoyaltyState({
    admin,
    customerAdminId,
    program: configuration.syncPlan.program,
  });

  return new Response();
};
