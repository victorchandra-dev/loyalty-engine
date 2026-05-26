// Shared utilities for the loyalty-checkout extension. Single source of truth
// for URL/JSON helpers used by shared.js so they are not hand-copied per file
// (audit M4). Checkout UI renders via s-element textContent, so HTML escaping
// is not needed here.

/**
 * Trim trailing slashes from a configured engine URL. Returns an empty string
 * when no value is provided so callers can fail closed instead of falling back
 * to a hard-coded host (audit M3).
 */
export function normalizeUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

/**
 * Parse a fetch Response body as JSON, tolerating empty bodies and surfacing a
 * clear error for malformed payloads.
 */
export async function readJson(response) {
  const textValue = await response.text();
  if (!textValue) return {};

  try {
    return JSON.parse(textValue);
  } catch {
    throw new Error('Loyalty rewards returned an invalid response.');
  }
}
