import {normalizeUrl, readJson} from './utils.js';

const REQUEST_TIMEOUT_MS = 8000;

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

export function renderSection({loadingText = 'Loading rewards...'} = {}) {
  const root = document.createElement('s-section');
  document.body.appendChild(root);
  root.replaceChildren(stack([heading('Rewards'), text(loadingText)]));
  return root;
}

export function renderEarnSummary(root, payload, options = {}) {
  const settings = payload.displaySettings || {};
  const program = payload.program || {};
  const earnRules = activeItems(program.earnRules);
  const children = [
    heading(options.heading || settings.widgetTitle || 'Rewards'),
    text(
      options.intro ||
        settings.widgetIntro ||
        'Earn points on eligible purchases and redeem rewards on future orders.',
    ),
  ];

  if (earnRules.length) {
    children.push(
      list(
        earnRules.map((rule) => {
          const value =
            rule.pointsValue === null || rule.pointsValue === undefined
              ? `1 ${settings.pointsLabel || 'point'} per spend unit`
              : `${Number(rule.pointsValue || 0).toLocaleString()} ${settings.pointsLabel || 'points'}`;
          return `${rule.title || rule.handle || 'Earn rule'}: ${value}`;
        }),
      ),
    );
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

export async function renderSlot(renderer, options = {}) {
  const root = renderSection({loadingText: options.loadingText || 'Loading rewards...'});
  try {
    const payload = await loadProgram();
    renderer(root, payload, options);
  } catch (error) {
    renderError(
      root,
      error instanceof Error ? error.message : 'Loyalty rewards could not load.',
    );
  }
}

function activeItems(items) {
  return Array.isArray(items) ? items.filter((item) => item.active !== false) : [];
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
