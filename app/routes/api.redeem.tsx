import type {ActionFunctionArgs} from 'react-router';
import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {
  applyRedemptionForCustomer,
  RedemptionError,
} from '../loyalty/customer-state.server';
import {fetchLoyaltyProgramConfiguration} from '../loyalty/program.server';
import {authenticate, unauthenticated} from '../shopify.server';

const SHARED_SECRET_HEADER = 'x-loyalty-engine-secret';
const SHOP_DOMAIN_HEADER = 'x-shopify-shop-domain';

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
  try {
    admin = await resolveAdminContext(request);
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

class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'AuthError';
  }
}

async function resolveAdminContext(
  request: Request,
): Promise<AdminApiContext> {
  const providedSecret = request.headers.get(SHARED_SECRET_HEADER);
  const expectedSecret = process.env.LOYALTY_ENGINE_SHARED_SECRET ?? '';

  // Shared-secret path (storefront → engine). Constant-time compare to avoid
  // timing oracles.
  if (providedSecret && expectedSecret) {
    if (!constantTimeEquals(providedSecret, expectedSecret)) {
      throw new AuthError('Invalid loyalty engine secret.', 401);
    }
    const shopDomain = request.headers.get(SHOP_DOMAIN_HEADER);
    if (!shopDomain) {
      throw new AuthError(
        `${SHOP_DOMAIN_HEADER} header is required for shared-secret auth.`,
        400,
      );
    }
    const {admin} = await unauthenticated.admin(shopDomain);
    return admin;
  }

  // Admin (embedded) path.
  const {admin} = await authenticate.admin(request);
  return admin;
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
