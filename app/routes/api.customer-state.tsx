import type {ActionFunctionArgs} from 'react-router';
import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {loadLoyaltyCustomer} from '../loyalty/customer-state.server';
import {
  AuthError,
  resolveAdminContext,
  verifyCustomerToken,
} from '../loyalty/engine-auth.server';

/**
 * A customer's loyalty numbers for the storefront: points, live spend, paid
 * orders and their unused reward (as the metafield's JSON string).
 *
 * The storefront can't read these app fields through the Customer Account API
 * (it returned null on the live store, 2 Oct), so it asks the engine, which
 * owns them. Same auth as /api/redeem: shared secret plus a token for this
 * exact customer.
 *
 * ponytail: one Admin API read per call, and the storefront calls it on page
 * loads for signed-in customers. Cache per customer for a few seconds if
 * traffic makes that matter.
 *
 * POST /api/customer-state  body: { customerAdminId }
 */
export const action = async ({request}: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return Response.json({error: 'Method not allowed'}, {status: 405});
  }

  let admin: AdminApiContext;
  let authPath: 'shared-secret' | 'admin';
  try {
    ({admin, authPath} = await resolveAdminContext(request));
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({error: error.message}, {status: error.status});
    }
    throw error;
  }

  let body: {customerAdminId?: unknown};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({error: 'Body must be JSON.'}, {status: 400});
  }
  const customerAdminId =
    typeof body.customerAdminId === 'string' && body.customerAdminId.trim()
      ? body.customerAdminId.trim()
      : null;
  if (!customerAdminId) {
    return Response.json({error: 'customerAdminId is required.'}, {status: 400});
  }

  if (authPath === 'shared-secret') {
    try {
      verifyCustomerToken({request, subjectId: customerAdminId});
    } catch (error) {
      if (error instanceof AuthError) {
        return Response.json({error: error.message}, {status: error.status});
      }
      throw error;
    }
  }

  try {
    const customer = await loadLoyaltyCustomer(admin, customerAdminId);
    if (!customer) {
      return Response.json({error: 'Customer not found.'}, {status: 404});
    }
    return Response.json({
      pointsBalance: customer.balance,
      lifetimeSpend: customer.lifetimeSpend,
      paidOrderCount: customer.paidOrderCount,
      currencyCode: customer.currencyCode,
      activeRedemption: customer.activeRedemption
        ? JSON.stringify(customer.activeRedemption)
        : null,
    });
  } catch (error) {
    console.error('[loyalty] customer-state failed', error);
    return Response.json({error: 'Could not load loyalty data.'}, {status: 500});
  }
};

export const loader = () => {
  return Response.json({error: 'Method not allowed'}, {status: 405});
};
