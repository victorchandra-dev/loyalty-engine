import type {ActionFunctionArgs} from 'react-router';
import {
  getOrdersPaidCustomerAdminId,
  getOrdersPaidDiscountCodes,
  getOrdersPaidOrderAmount,
  getOrdersPaidOrderGid,
} from '../../src/webhooks/orders-paid.js';
import type {OrdersPaidWebhookPayload} from '../../src/webhooks/orders-paid.js';
import {projectPaidOrder} from '../../src/domain/customer-state.js';
import {
  loadLoyaltyCustomer,
  loadProgramSnapshot,
  saveLoyaltyCustomer,
} from '../loyalty/customer-state.server';
import {runOnce} from '../loyalty/run-once.server';
import {authenticate} from '../shopify.server';

/**
 * Award points for a paid order: order points, the first-order signup bonus,
 * a referral bonus for both sides, and clearing the reward checkout applied.
 *
 * Each order is processed once (runOnce). Any failure returns 500 so Shopify
 * retries; nothing is written unless the whole change is written.
 */
export const action = async ({request}: ActionFunctionArgs) => {
  const {payload, shop, topic, session, admin} =
    await authenticate.webhook(request);

  console.warn(`Received ${topic} webhook for ${shop}`);

  if (!session || !admin) {
    return new Response();
  }

  const order = payload as OrdersPaidWebhookPayload;
  const customerAdminId = getOrdersPaidCustomerAdminId(order);
  const orderGid = getOrdersPaidOrderGid(order);
  if (!customerAdminId || !orderGid) {
    return new Response();
  }

  try {
    await runOnce(`orders/paid:${orderGid}`, async () => {
      const {enabled, program} = await loadProgramSnapshot(admin);
      if (!enabled || !program) return;

      const customer = await loadLoyaltyCustomer(admin, customerAdminId);
      if (!customer) return;

      const result = projectPaidOrder({
        customer,
        program,
        orderAmount: getOrdersPaidOrderAmount(order),
        discountCodes: getOrdersPaidDiscountCodes(order),
      });
      const referrer = result.referral
        ? await loadLoyaltyCustomer(admin, result.referral.referrerId)
        : null;

      await saveLoyaltyCustomer(admin, {
        program,
        customer,
        balance: result.balance,
        awardedRules: result.awardedRules,
        ...(result.clearRedemption ? {activeRedemption: null} : {}),
        referralCredited: Boolean(result.referral),
        ...(result.referral && referrer
          ? {referrer: {customer: referrer, balance: referrer.balance + result.referral.points}}
          : {}),
      });
    });
  } catch (error) {
    console.error(`[loyalty] orders/paid failed for ${orderGid}; Shopify will retry`);
    console.error(error);
    return new Response(null, {status: 500});
  }

  return new Response();
};
