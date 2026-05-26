import {formatCurrency, normalizeUrl, readJson} from './utils.js';

const REQUEST_TIMEOUT_MS = 8000;
const CUSTOMER_ACCOUNT_API_VERSION = '2026-04';

export async function loadProgram() {
  const settings = getSettings();
  // Fail closed: without an engine URL and shop domain there is no safe default
  // to fall back to, so surface a clear error instead of guessing a host
  // (audit M3).
  if (!settings.engineUrl || !settings.shopDomain) {
    throw new Error(
      'Loyalty block is not configured (engine URL or shop domain missing).',
    );
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `${settings.engineUrl}/api/public-loyalty-program?shop=${encodeURIComponent(settings.shopDomain)}`,
      {headers: {Accept: 'application/json'}, signal: controller.signal},
    );
    const payload = await readJson(response);
    if (!response.ok) {
      throw new Error(payload.error || 'Loyalty rewards could not load.');
    }
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

export async function loadCustomerLoyalty() {
  const query = {
    query: `query LoyaltyCustomerAccount {
      customer {
        id
        firstName
        loyaltyState: metafield(namespace: "$app", key: "loyalty_state") {
          value
        }
        pointsBalance: metafield(namespace: "$app", key: "loyalty_points_balance") {
          value
        }
        activeRedemption: metafield(namespace: "$app", key: "loyalty_active_redemption") {
          value
        }
      }
    }`,
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(
      `shopify://customer-account/api/${CUSTOMER_ACCOUNT_API_VERSION}/graphql.json`,
      {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(query),
        signal: controller.signal,
      },
    );
    const payload = await readJson(response);
    if (!response.ok || payload.errors?.length) {
      throw new Error(
        payload.errors?.[0]?.message || 'Customer loyalty could not load.',
      );
    }

    const customer = payload.data?.customer;
    if (!customer) return null;

    return {
      id: customer.id,
      firstName: customer.firstName || null,
      pointsBalance: parseInteger(customer.pointsBalance?.value),
      state: parseLoyaltyState(customer.loyaltyState?.value),
      activeRedemption: parseJson(customer.activeRedemption?.value),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function renderSection({loadingText = 'Loading rewards...'} = {}) {
  const root = document.createElement('s-section');
  document.body.appendChild(root);
  root.replaceChildren(stack([heading('Rewards'), text(loadingText)]));
  return root;
}

export function renderProgramSummary(root, payload, options = {}) {
  const settings = payload.displaySettings || {};
  const program = payload.program || {};
  const tiers = Array.isArray(program.tiers) ? program.tiers : [];
  const redemptions = Array.isArray(program.redemptions)
    ? program.redemptions.filter((item) => item.active !== false)
    : [];
  const earnRules = Array.isArray(program.earnRules)
    ? program.earnRules.filter((item) => item.active !== false)
    : [];

  const children = [
    heading(options.heading || settings.widgetTitle || 'Rewards'),
    text(
      options.intro ||
        settings.widgetIntro ||
        'Earn points, unlock tiers, and redeem rewards at checkout.',
    ),
  ];

  if (options.customerLoyalty) {
    children.push(...customerSummaryLines(options.customerLoyalty, payload));
  }

  if (options.showEarnRules && earnRules.length) {
    children.push(subheading('Ways to earn'));
    children.push(
      list(
        earnRules.map((rule) => {
          const points =
            rule.pointsValue === null || rule.pointsValue === undefined
              ? '1 point per spend unit'
              : `${Number(rule.pointsValue || 0).toLocaleString()} ${settings.pointsLabel || 'points'}`;
          return `${rule.title || rule.handle}: ${points}`;
        }),
      ),
    );
  }

  if (options.showTiers !== false && tiers.length) {
    children.push(subheading('Member tiers'));
    children.push(list(tiers.map((tier) => tierLine(tier, payload.currencyCode))));
  }

  if (options.showRedemptions !== false && redemptions.length) {
    children.push(subheading('Redeem rewards'));
    children.push(
      list(
        redemptions.map((redemption) =>
          redemptionLine(redemption, settings.pointsLabel),
        ),
      ),
    );
  }

  const linkTarget = options.linkTarget || 'extension:loyalty-rewards-page';
  if (options.showRewardsPageLink) {
    const link = document.createElement('s-link');
    link.setAttribute('href', linkTarget);
    link.textContent = 'Open rewards';
    children.push(link);
  }

  root.replaceChildren(stack(children));
}

export function renderError(root, message) {
  const banner = document.createElement('s-banner');
  banner.setAttribute('tone', 'critical');
  banner.appendChild(text(message));
  root.replaceChildren(banner);
}

export function stack(children) {
  const element = document.createElement('s-stack');
  element.setAttribute('direction', 'block');
  element.setAttribute('gap', 'base');
  for (const child of children) {
    if (child) element.appendChild(child);
  }
  return element;
}

export function heading(value) {
  const element = document.createElement('s-heading');
  element.textContent = value;
  return element;
}

export function subheading(value) {
  const element = document.createElement('s-text');
  element.setAttribute('type', 'strong');
  element.textContent = value;
  return element;
}

export function text(value) {
  const element = document.createElement('s-text');
  element.textContent = value;
  return element;
}

export function list(lines) {
  const element = document.createElement('s-unordered-list');
  for (const line of lines) {
    const item = document.createElement('s-list-item');
    item.textContent = line;
    element.appendChild(item);
  }
  return element;
}

function getSettings() {
  // globalThis is an ES2020 global; the shared eslint env predates it. Used
  // (not bare `shopify`) so an absent runtime binding is safe.
  // eslint-disable-next-line no-undef
  const settings = globalThis.shopify?.settings?.current ?? {};
  return {
    engineUrl: normalizeUrl(settings.engine_url),
    shopDomain: (settings.shop_domain || '').trim(),
  };
}

function tierLine(tier, currencyCode) {
  const label = tier.name || tier.label || tier.handle || 'Reward tier';
  const threshold = formatCurrency(tier.minimumValue, currencyCode);
  const benefit = tier.discountPercentage
    ? `${tier.discountPercentage}% off`
    : 'Member reward';
  return `${label}: ${benefit} at ${threshold}`;
}

function redemptionLine(redemption, pointsLabel) {
  const title = redemption.title || redemption.handle || 'Reward';
  const points = Number(redemption.pointsCost || 0).toLocaleString();
  return `${title}: ${points} ${pointsLabel || 'points'}`;
}

function customerSummaryLines(customerLoyalty, payload) {
  const settings = payload.displaySettings || {};
  const program = payload.program || {};
  const pointsLabel = settings.pointsLabel || 'points';
  const pointsBalance = Number(customerLoyalty.pointsBalance || 0);
  const state = customerLoyalty.state || {};
  const metrics = state.metrics || {};
  const tiers = Array.isArray(program.tiers) ? program.tiers : [];
  const currentTier = getCurrentTier(tiers, state.currentTierHandle, metrics);
  const nextTier = getNextTier(tiers, currentTier, metrics);
  const lines = [
    subheading('Your rewards'),
    list([
      `Available points: ${pointsBalance.toLocaleString()} ${pointsLabel}`,
      `Total XP: ${pointsBalance.toLocaleString()} XP`,
      `Current tier: ${currentTier?.name || 'Starter'}`,
      nextTier
        ? `Next tier: ${nextTier.name} at ${formatTierThreshold(nextTier, payload.currencyCode)} (${formatMetricProgress(nextTier, metrics, pointsBalance, payload.currencyCode)})`
        : 'Next tier: Top tier reached',
    ]),
  ];

  if (customerLoyalty.activeRedemption?.redemptionHandle) {
    lines.push(
      text(
        `Active redemption: ${customerLoyalty.activeRedemption.redemptionHandle}`,
      ),
    );
  }

  return lines;
}

function getCurrentTier(tiers, currentTierHandle, metrics) {
  if (currentTierHandle) {
    const current = tiers.find((tier) => tier.handle === currentTierHandle);
    if (current) return current;
  }

  return tiers
    .filter((tier) => metricValueForTier(tier, metrics) >= Number(tier.minimumValue || 0))
    .at(-1) || null;
}

function getNextTier(tiers, currentTier, metrics) {
  const currentOrder = currentTier ? Number(currentTier.order || 0) : -1;
  return (
    tiers.find((tier) => {
      if (Number(tier.order || 0) <= currentOrder) return false;
      return metricValueForTier(tier, metrics) < Number(tier.minimumValue || 0);
    }) || null
  );
}

function metricValueForTier(tier, metrics) {
  switch (tier.metric) {
    case 'paid_order_count':
      return Number(metrics.paidOrderCount || 0);
    case 'points_balance':
      return Number(metrics.pointsBalance || 0);
    case 'lifetime_spend':
    default:
      return Number(metrics.lifetimeSpend || 0);
  }
}

function formatTierThreshold(tier, currencyCode) {
  if (tier.metric === 'paid_order_count') {
    return `${Number(tier.minimumValue || 0).toLocaleString()} orders`;
  }
  if (tier.metric === 'points_balance') {
    return `${Number(tier.minimumValue || 0).toLocaleString()} points`;
  }
  return formatCurrency(tier.minimumValue, currencyCode);
}

function formatMetricProgress(tier, metrics, pointsBalance, currencyCode) {
  const current =
    tier.metric === 'points_balance'
      ? pointsBalance
      : metricValueForTier(tier, metrics);
  const target = Number(tier.minimumValue || 0);
  if (tier.metric === 'paid_order_count') {
    return `${current.toLocaleString()} / ${target.toLocaleString()} orders`;
  }
  if (tier.metric === 'points_balance') {
    return `${current.toLocaleString()} / ${target.toLocaleString()} points`;
  }
  return `${formatCurrency(current, currencyCode)} / ${formatCurrency(target, currencyCode)}`;
}

function parseInteger(value) {
  const parsed = Number.parseInt(value ?? '0', 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLoyaltyState(value) {
  const parsed = parseJson(value);
  return parsed && typeof parsed === 'object' ? parsed : null;
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}
