import type {ActionFunctionArgs} from 'react-router';
import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {
  applyRedemptionForCustomer,
  RedemptionError,
} from '../loyalty/customer-state.server';
import {fetchLoyaltyProgramConfiguration} from '../loyalty/program.server';
import {
  AuthError,
  resolveAdminContext,
  verifyCustomerToken,
} from '../loyalty/engine-auth.server';
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIdentifier,
} from '../loyalty/rate-limiter.server';

// Tight per-IP limit on this loyalty mutation: a leaked shared secret must not
// allow unbounded redemption-handle brute forcing (audit M2).
const REDEEM_RATE_LIMIT = {maxRequests: 6, windowMs: 15 * 60 * 1000};

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

  const rateLimit = checkRateLimit(
    `redeem:${getClientIdentifier(request)}`,
    REDEEM_RATE_LIMIT,
  );
  if (!rateLimit.allowed) {
    return Response.json(
      {error: 'Too many requests. Please try again later.'},
      {status: 429, headers: createRateLimitHeaders(rateLimit)},
    );
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

  const configuration = await fetchLoyaltyProgramConfiguration(admin);
  if (!configuration.syncPlan.program) {
    return Response.json(
      {error: 'Program is not initialised. Run sync first.'},
      {status: 409},
    );
  }

  try {
    const result = await applyRedemptionForCustomer({
      admin,
      customerAdminId,
      redemptionHandle,
      program: configuration.syncPlan.program,
    });
    return Response.json({
      ok: true,
      newBalance: result.newBalance,
      redemption: result.redemption,
    });
  } catch (error) {
    if (error instanceof RedemptionError) {
      return Response.json({error: error.message}, {status: error.status});
    }
    console.error('[loyalty] applyRedemptionForCustomer failed', error);
    return Response.json(
      {error: 'Failed to apply redemption.'},
      {status: 500},
    );
  }
};

export const loader = () => {
  return Response.json({error: 'Method not allowed'}, {status: 405});
};
