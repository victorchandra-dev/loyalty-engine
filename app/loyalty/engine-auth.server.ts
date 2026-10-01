import {createHmac, timingSafeEqual} from 'node:crypto';
import type {AdminApiContext} from '@shopify/shopify-app-react-router/server';
import {authenticate, unauthenticated} from '../shopify.server';

export const SHARED_SECRET_HEADER = 'x-loyalty-engine-secret';
export const SHOP_DOMAIN_HEADER = 'x-shopify-shop-domain';
export const CUSTOMER_TOKEN_HEADER = 'x-loyalty-customer-token';

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = 'AuthError';
  }
}

/**
 * Constant-time string comparison built on node:crypto's timingSafeEqual.
 * timingSafeEqual throws when the buffers differ in length, so guard that up
 * front (an early length-based reject is acceptable here — it does not leak the
 * secret's contents).
 */
function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

export type AuthPath = 'shared-secret' | 'admin';

/**
 * Resolve an Admin API client for an incoming engine request and report which
 * auth path was used so callers can layer additional checks.
 *
 *  - Shared-secret path (storefront → engine): the caller sends
 *    `x-loyalty-engine-secret` matching env LOYALTY_ENGINE_SHARED_SECRET plus
 *    `x-shopify-shop-domain`. If the header is present we validate it strictly
 *    and never fall through to admin auth (storefront requests carry no
 *    embedded session). Per-customer authorization is NOT verified here — the
 *    route must call verifyCustomerToken for that.
 *  - Admin (embedded) path: only reached when no shared-secret header is sent.
 *    Exempt from per-customer token verification.
 */
export async function resolveAdminContext(
  request: Request,
): Promise<{admin: AdminApiContext; authPath: AuthPath; shop: string}> {
  const providedSecret = request.headers.get(SHARED_SECRET_HEADER);

  if (providedSecret !== null) {
    const expectedSecret = process.env.LOYALTY_ENGINE_SHARED_SECRET ?? '';
    if (!expectedSecret) {
      throw new AuthError(
        'LOYALTY_ENGINE_SHARED_SECRET is not configured on this server.',
        500,
      );
    }
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
    return {admin, authPath: 'shared-secret', shop: shopDomain};
  }

  const {admin, session} = await authenticate.admin(request);
  return {admin, authPath: 'admin', shop: session.shop};
}

function fromBase64Url(value: string): string {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signCustomerToken(subjectId: string, exp: number, secret: string): string {
  return createHmac('sha256', secret)
    .update(`${subjectId}.${exp}`)
    .digest('hex');
}

/**
 * Verify the per-customer authorization token bound to `subjectId`.
 *
 * Token format: `${base64url(exp)}.${hex(hmac)}` where
 *   hmac = HMAC-SHA256(LOYALTY_CUSTOMER_TOKEN_SECRET, `${subjectId}.${exp}`)
 *   exp  = unix seconds the token expires.
 *
 * The storefront mints this after resolving the customer GID from the Customer
 * Account session, so a valid token proves the caller is acting for that exact
 * customer — closing the IDOR where the shared secret alone let any holder move
 * points for an arbitrary customerAdminId.
 *
 * Check order is deliberate: token absence/malformation/expiry reject with 403
 * BEFORE we look at whether the signing secret is configured. That keeps an
 * unauthenticated attack shape (no token) a clean 403 rather than leaking an
 * operator-misconfig 500; a present-but-unverifiable token with the secret
 * unset is a genuine server misconfiguration → 500.
 */
export function verifyCustomerToken({
  request,
  subjectId,
}: {
  request: Request;
  subjectId: string;
}): void {
  const token = request.headers.get(CUSTOMER_TOKEN_HEADER);
  if (!token || !token.trim()) {
    throw new AuthError(
      `${CUSTOMER_TOKEN_HEADER} header is required.`,
      403,
    );
  }

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AuthError('Malformed customer token.', 403);
  }

  let exp: number;
  try {
    exp = Number.parseInt(fromBase64Url(parts[0]), 10);
  } catch {
    throw new AuthError('Malformed customer token.', 403);
  }
  if (!Number.isFinite(exp)) {
    throw new AuthError('Malformed customer token.', 403);
  }

  const nowSeconds = Math.floor(Date.now() / 1000);
  if (exp < nowSeconds) {
    throw new AuthError('Customer token has expired.', 403);
  }

  const secret = process.env.LOYALTY_CUSTOMER_TOKEN_SECRET ?? '';
  if (!secret) {
    throw new AuthError(
      'LOYALTY_CUSTOMER_TOKEN_SECRET is not configured on this server.',
      500,
    );
  }

  const expected = signCustomerToken(subjectId, exp, secret);
  if (!constantTimeEquals(parts[1], expected)) {
    throw new AuthError(
      'Customer token does not authorize the supplied customer.',
      403,
    );
  }
}
