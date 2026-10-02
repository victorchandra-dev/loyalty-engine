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
import {recordPointsEvents, type PointsEventInput} from '../loyalty/points-history.server';
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
    console.log(`[loyalty] orders/paid ${orderGid ?? '?'}: skipped, no customer on the order (guest checkout)`);
    return new Response();
  }

  try {
    await runOnce(`orders/paid:${orderGid}`, async () => {
      const {enabled, program} = await loadProgramSnapshot(admin);
      if (!enabled || !program) {
        console.log(`[loyalty] orders/paid ${orderGid}: skipped, program ${program ? 'paused' : 'not set up'}`);
        return;
      }

      const customer = await loadLoyaltyCustomer(admin, customerAdminId);
      if (!customer) {
        console.log(`[loyalty] orders/paid ${orderGid}: skipped, customer ${customerAdminId} not found`);
        return;
      }

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

      let balance = customer.balance;
      const history: PointsEventInput[] = result.earned.map(({type, points}) => {
        balance += points;
        return {customerId: customer.id, type, points, balance, orderId: orderGid};
      });
      if (result.clearRedemption && customer.activeRedemption) {
        const {code, handle} = customer.activeRedemption;
        history.push({customerId: customer.id, type: 'reward_used', points: 0, balance: result.balance, orderId: orderGid, data: {code, handle}});
      }
      if (result.referral && referrer) {
        history.push({
          customerId: referrer.id,
          type: 'referral',
          points: result.referral.points,
          balance: referrer.balance + result.referral.points,
          orderId: orderGid,
          data: {refereeId: customer.id},
        });
      }
      await recordPointsEvents(shop, history);
      // One line per order, so "why didn't I get points?" is answerable from the logs.
      console.log(
        `[loyalty] orders/paid ${orderGid}: ${customer.id} ${customer.balance} -> ${result.balance}` +
          ` (${result.earned.map((part) => `${part.type} +${part.points}`).join(', ') || 'nothing earned'};` +
          ` already awarded: ${customer.awardedRules.join(', ') || 'none'})` +
          (result.clearRedemption ? ', reward used' : ''),
      );
    });
  } catch (error) {
    console.error(`[loyalty] orders/paid failed for ${orderGid}; Shopify will retry`);
    console.error(error);
    return new Response(null, {status: 500});
  }

  return new Response();
};
