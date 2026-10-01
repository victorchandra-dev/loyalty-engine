// Shared utilities for the loyalty-checkout extension. Single source of truth
// for helpers used by shared.js so they are not hand-copied per file (audit M4).
// Checkout UI renders via s-element textContent, so HTML escaping is not needed.

/**
 * Read the app-owned loyalty program snapshot from shopify.appMetafields.
 *
 * The snapshot ($app:loyalty_program_snapshot, declared in shopify.extension.toml)
 * is a shop metafield containing {enabled, displaySettings, currencyCode, program}.
 * Reading it here removes the need for a pasted engine URL and an external fetch
 * (zero-config). Returns null when the metafield is missing or unparseable so
 * callers can fail closed with a clear message.
 */
export function readShopSnapshot() {
  // globalThis is an ES2020 global; the shared eslint env predates it. Used
  // (not bare `shopify`) so an absent runtime binding is safe.
  // eslint-disable-next-line no-undef
  const entries = globalThis.shopify?.appMetafields?.value ?? [];
  // Match on the (app-unique) key + shop target. The namespace is intentionally
  // not asserted: the runtime may report the resolved app-reserved namespace
  // rather than the literal "$app", and only this one metafield is declared.
  const entry = entries.find(
    (item) =>
      item?.target?.type === 'shop' &&
      item?.metafield?.key === 'loyalty_program_snapshot',
  );
  if (!entry?.metafield?.value) return null;

  try {
    return JSON.parse(entry.metafield.value);
  } catch {
    return null;
  }
}
