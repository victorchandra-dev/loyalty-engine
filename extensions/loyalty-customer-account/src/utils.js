// Shared utilities for the loyalty-customer-account extension. Single source of
// truth for the URL/JSON/currency helpers used by shared.js so they are not
// hand-copied per file (audit M4). Account UI renders via s-element textContent,
// so HTML escaping is not needed here.

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

/**
 * Format a numeric amount as currency, falling back to a plain localized number
 * when the currency code is missing or unsupported by the runtime.
 */
export function formatCurrency(value, currencyCode) {
  const amount = Number(value || 0);
  if (!currencyCode) return amount.toLocaleString();
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return amount.toLocaleString();
  }
}
