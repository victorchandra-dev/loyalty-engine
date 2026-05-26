/**
 * Simple in-memory rate limiter for the loyalty engine (Fly/Node).
 * Uses a sliding window algorithm with automatic cleanup.
 *
 * Ported from the Hydrogen storefront's `app/lib/rate-limiter.server.ts`
 * (audit M2). Note: each engine instance maintains its own rate-limit state,
 * so the effective limit scales with instance count. For strict global limiting
 * across instances, back this with Redis or a shared store.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// In-memory store for rate limit tracking
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries every 5 minutes to prevent memory leaks
const CLEANUP_INTERVAL = 5 * 60 * 1000;
let lastCleanup = Date.now();

function cleanupExpiredEntries() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;

  lastCleanup = now;
  for (const [key, entry] of rateLimitStore.entries()) {
    if (entry.resetAt < now) {
      rateLimitStore.delete(key);
    }
  }
}

export interface RateLimitConfig {
  /** Maximum number of requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
}

export interface RateLimitResult {
  /** Whether the request is allowed */
  allowed: boolean;
  /** Number of requests remaining in the current window */
  remaining: number;
  /** Timestamp when the rate limit resets */
  resetAt: number;
  /** Number of seconds until reset */
  retryAfter: number;
}

/**
 * Check if a request should be rate limited
 * @param identifier - Unique identifier for the client (e.g., IP address, email)
 * @param config - Rate limit configuration
 * @returns RateLimitResult with allowed status and metadata
 */
export function checkRateLimit(
  identifier: string,
  config: RateLimitConfig,
): RateLimitResult {
  cleanupExpiredEntries();

  const now = Date.now();
  const entry = rateLimitStore.get(identifier);

  // No existing entry or window expired - create new entry
  if (!entry || entry.resetAt < now) {
    const resetAt = now + config.windowMs;
    rateLimitStore.set(identifier, {count: 1, resetAt});
    return {
      allowed: true,
      remaining: config.maxRequests - 1,
      resetAt,
      retryAfter: 0,
    };
  }

  // Window still active - check if limit exceeded
  if (entry.count >= config.maxRequests) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt: entry.resetAt,
      retryAfter,
    };
  }

  // Increment counter
  entry.count++;
  return {
    allowed: true,
    remaining: config.maxRequests - entry.count,
    resetAt: entry.resetAt,
    retryAfter: 0,
  };
}

/**
 * Get client identifier from request
 * Extracts IP address from various headers (Cloudflare, proxies, direct)
 */
export function getClientIdentifier(request: Request): string {
  // Cloudflare/Shopify Oxygen provides CF-Connecting-IP
  const cfIp = request.headers.get('cf-connecting-ip');
  if (cfIp) return cfIp;

  // X-Forwarded-For may contain multiple IPs, use the first one
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const firstIp = forwardedFor.split(',')[0].trim();
    if (firstIp) return firstIp;
  }

  // X-Real-IP header
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;

  // Fallback - shouldn't happen in production
  return 'unknown';
}

/**
 * Create rate limit response headers
 */
export function createRateLimitHeaders(result: RateLimitResult): HeadersInit {
  return {
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.resetAt),
    ...(result.retryAfter > 0 && {'Retry-After': String(result.retryAfter)}),
  };
}
