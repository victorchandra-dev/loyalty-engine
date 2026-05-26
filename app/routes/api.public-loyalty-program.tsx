import type {LoaderFunctionArgs} from 'react-router';
import {fetchLoyaltyProgramConfiguration} from '../loyalty/program.server';
import {
  fetchDisplaySettings,
  fetchProgramEnabled,
} from '../loyalty/settings.server';
import {unauthenticated} from '../shopify.server';
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIdentifier,
} from '../loyalty/rate-limiter.server';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};
const PUBLIC_HEADERS = {
  ...CORS_HEADERS,
  'Cache-Control': 'public, max-age=60, stale-while-revalidate=300',
};

// Looser per-IP limit on the public config endpoint to blunt fetch fan-out and
// Admin-API quota exhaustion without breaking normal storefront polling
// (audit M2).
const PUBLIC_RATE_LIMIT = {maxRequests: 60, windowMs: 60 * 1000};

export const loader = async ({request}: LoaderFunctionArgs) => {
  if (request.method === 'OPTIONS') {
    return new Response(null, {status: 204, headers: PUBLIC_HEADERS});
  }

  const rateLimit = checkRateLimit(
    `public-loyalty-program:${getClientIdentifier(request)}`,
    PUBLIC_RATE_LIMIT,
  );
  if (!rateLimit.allowed) {
    return Response.json(
      {error: 'Too many requests. Please try again later.'},
      {
        status: 429,
        headers: {...CORS_HEADERS, ...createRateLimitHeaders(rateLimit)},
      },
    );
  }

  const url = new URL(request.url);
  // Require a valid shop param. The optional LOYALTY_DEFAULT_SHOP_DOMAIN env var
  // remains as an operator override, but there is no hard-coded literal fallback
  // (audit M3); without either, fail with a 400 rather than silently serving a
  // single tenant's program.
  const shop =
    normalizeShopDomain(url.searchParams.get('shop')) ||
    normalizeShopDomain(process.env.LOYALTY_DEFAULT_SHOP_DOMAIN);

  if (!shop) {
    return Response.json(
      {error: 'A valid shop query parameter is required.'},
      {status: 400, headers: PUBLIC_HEADERS},
    );
  }

  try {
    const {admin} = await unauthenticated.admin(shop);
    const [configuration, enabledState, displayState] = await Promise.all([
      fetchLoyaltyProgramConfiguration(admin),
      fetchProgramEnabled(admin),
      fetchDisplaySettings(admin),
    ]);

    return Response.json(
      {
        shop,
        enabled: enabledState.enabled,
        displaySettings: displayState.settings,
        currencyCode: configuration.currencyCode,
        program: configuration.syncPlan.program,
        issues: configuration.syncPlan.issues,
        storefront: {
          hydrogen: {
            supported: displayState.settings.hydrogenEnabled,
            accountPagePath: '/account/loyalty',
            redemptionEndpoint: '/api/loyalty/redeem',
          },
          liquid: {
            supported: displayState.settings.liquidEnabled,
            publicProgramEndpoint: `/api/public-loyalty-program?shop=${shop}`,
          },
        },
      },
      {headers: PUBLIC_HEADERS},
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Failed to load public loyalty program.',
      },
      {status: 500, headers: PUBLIC_HEADERS},
    );
  }
};

function normalizeShopDomain(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  if (!trimmed) return null;
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}
