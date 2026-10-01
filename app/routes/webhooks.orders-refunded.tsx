import type {ActionFunctionArgs} from 'react-router';
import {
  computeRefundPointsDebit,
  getOrdersRefundedAmount,
  getOrdersRefundedOrderGid,
  getRefundGid,
} from '../../src/webhooks/orders-refunded.js';
import type {OrdersRefundedWebhookPayload} from '../../src/webhooks/orders-refunded.js';
import {
  fetchOrderCustomerId,
  loadLoyaltyCustomer,
  loadProgramSnapshot,
  saveLoyaltyCustomer,
} from '../loyalty/customer-state.server';
import {runOnce} from '../loyalty/run-once.server';
import {authenticate} from '../shopify.server';

/**
 * Take back the points a refund reverses (refunds/create). The payload is the
 * refund itself, so the customer is looked up from its order. Each refund is
 * processed once; failures return 500 so Shopify retries.
 */
export const action = async ({request}: ActionFunctionArgs) => {
  const {payload, shop, topic, session, admin} =
    await authenticate.webhook(request);

  console.warn(`Received ${topic} webhook for ${shop}`);

  if (!session || !admin) {
    return new Response();
  }

  const refund = payload as OrdersRefundedWebhookPayload;
  const refundGid = getRefundGid(refund);
  const orderGid = getOrdersRefundedOrderGid(refund);
  const refundedAmount = getOrdersRefundedAmount(refund);
  if (!refundGid || !orderGid || refundedAmount <= 0) {
    // No money refunded (e.g. a restock-only refund): nothing to take back.
    return new Response();
  }

  try {
    await runOnce(`refunds/create:${refundGid}`, async () => {
      const {program} = await loadProgramSnapshot(admin);
      if (!program) return;

      const debit = computeRefundPointsDebit({
        refundedAmount,
        earnRules: program.earnRules,
      });
      if (debit <= 0) return;

      const customerAdminId = await fetchOrderCustomerId(admin, orderGid);
      if (!customerAdminId) return;
      const customer = await loadLoyaltyCustomer(admin, customerAdminId);
      if (!customer) return;

      await saveLoyaltyCustomer(admin, {
        program,
        customer,
        balance: Math.max(0, customer.balance - debit),
      });
    });
  } catch (error) {
    console.error(`[loyalty] refunds/create failed for ${refundGid}; Shopify will retry`);
    console.error(error);
    return new Response(null, {status: 500});
  }

  return new Response();
};
