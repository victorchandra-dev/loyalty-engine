import {readShopSnapshot} from './utils.js';

// Zero-config: the program snapshot is delivered as the app-owned shop metafield
// declared in shopify.extension.toml ($app:loyalty_program_snapshot) and read via
// shopify.appMetafields — no engine URL, no shop domain, no network fetch.
export function loadProgram() {
  const snapshot = readShopSnapshot();
  if (!snapshot) {
    // eslint-disable-next-line no-undef
    const entries = globalThis.shopify?.appMetafields?.value ?? [];
    const summary = entries
      .map((e) => `${e?.target?.type}:${e?.metafield?.key}`)
      .join(', ');
    throw new Error(
      `Loyalty rewards unavailable. appMetafields(${entries.length})=[${summary}]`,
    );
  }
  return snapshot;
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
