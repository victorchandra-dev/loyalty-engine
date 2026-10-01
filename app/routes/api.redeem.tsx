import {randomBytes} from 'node:crypto';
import type {ActionFunctionArgs} from 'react-router';
import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {projectRedemption} from '../../src/domain/customer-state.js';
import {
  createRewardCode,
  deleteRewardCode,
  loadLoyaltyCustomer,
  loadProgramSnapshot,
  saveLoyaltyCustomer,
} from '../loyalty/customer-state.server';
import {
  AuthError,
  resolveAdminContext,
  verifyCustomerToken,
} from '../loyalty/engine-auth.server';
import {recordPointsEvents} from '../loyalty/points-history.server';

// ponytail: no rate limit here. The only caller is the storefront server, which
// rate-limits per shopper IP; an engine-side per-IP limit would be shared by all
// shoppers. The customer token below still binds each call to one customer.

/**
 * Apply a redemption for a customer.
 *
 * Two auth paths:
 *  - Shared-secret: storefront-driven calls send `X-Loyalty-Engine-Secret`
 *    matching env `LOYALTY_ENGINE_SHARED_SECRET`, plus
 *    `X-Shopify-Shop-Domain: <shop>.myshopify.com` so the engine can build an
 *    Admin API client for that shop via `unauthenticated.admin(shop)`. The
 *    Hydrogen storefront authenticates the customer via Customer Account API
 *    before calling this endpoint, then forwards the resolved customer GID.
 *  - Admin auth: lets ops/QA call the same endpoint from the embedded admin
 *    surface.
 *
 * POST /api/redeem
 * body: { customerAdminId: string, redemptionHandle: string }
 *
 * 200: { ok: true, newBalance, redemption }
 * 400/401/404/409: { error }
 * 405:    method not allowed
 */
export const action = async ({request}: ActionFunctionArgs) => {
  if (request.method !== 'POST') {
    return Response.json({error: 'Method not allowed'}, {status: 405});
  }

  let admin: AdminApiContext;
  let authPath: 'shared-secret' | 'admin';
  let shop: string;
  try {
    ({admin, authPath, shop} = await resolveAdminContext(request));
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({error: error.message}, {status: error.status});
    }
    throw error;
  }

  let body: {customerAdminId?: unknown; redemptionHandle?: unknown};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({error: 'Body must be JSON.'}, {status: 400});
  }

  const customerAdminId =
    typeof body.customerAdminId === 'string' && body.customerAdminId.trim()
      ? body.customerAdminId.trim()
      : null;
  const redemptionHandle =
    typeof body.redemptionHandle === 'string' && body.redemptionHandle.trim()
      ? body.redemptionHandle.trim()
      : null;

  if (!customerAdminId || !redemptionHandle) {
    return Response.json(
      {error: 'customerAdminId and redemptionHandle are required.'},
      {status: 400},
    );
  }

  // Per-customer authorization: the shared secret alone does not bind a request
  // to a customer, so storefront calls must also carry a token proving they act
  // for this exact customerAdminId. Admin (embedded) calls are exempt.
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
    const {enabled, program} = await loadProgramSnapshot(admin);
    if (!enabled || !program) {
      return Response.json({error: 'The loyalty program is not active.'}, {status: 409});
    }
    const customer = await loadLoyaltyCustomer(admin, customerAdminId);
    if (!customer) {
      return Response.json({error: 'Customer not found.'}, {status: 404});
    }

    const result = projectRedemption({
      customer,
      program,
      handle: redemptionHandle,
      now: new Date(),
      code: `LF-${randomBytes(5).toString('hex').toUpperCase()}`,
    });
    if (!result.ok) {
      return Response.json({error: result.message}, {status: result.status});
    }

    // Create the code first, then take the points. If the points can't be
    // saved (the balance changed since it was read, e.g. a double click), the
    // code is deleted again, so a reward is never free and never paid twice.
    const title =
      program.redemptions.find((entry) => entry.handle === redemptionHandle)?.title ??
      redemptionHandle;
    const discountId = await createRewardCode(admin, {
      customerAdminId,
      title,
      redemption: result.activeRedemption,
    });
    const redemption = {...result.activeRedemption, discountId};
    try {
      await saveLoyaltyCustomer(admin, {
        program,
        customer,
        balance: result.balance,
        activeRedemption: redemption,
      });
    } catch (error) {
      await deleteRewardCode(admin, discountId).catch((cleanupError) => {
        console.error(`[loyalty] Orphaned reward code ${discountId}; delete it in Discounts`);
        console.error(cleanupError);
      });
      throw error;
    }
    await recordPointsEvents(shop, [{
      customerId: customer.id,
      type: 'redeem',
      points: -redemption.pointsCost,
      balance: result.balance,
      data: {handle: redemption.handle, title, code: redemption.code, discountId, expiresAt: redemption.expiresAt},
    }]);
    return Response.json({ok: true, newBalance: result.balance, redemption});
  } catch (error) {
    console.error('[loyalty] redeem failed', error);
    return Response.json(
      {error: 'Failed to apply redemption. Please try again.'},
      {status: 500},
    );
  }
};

export const loader = () => {
  return Response.json({error: 'Method not allowed'}, {status: 405});
};
