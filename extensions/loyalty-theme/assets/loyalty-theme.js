(function () {
  const REQUEST_TIMEOUT_MS = 8000;

  init();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, {once: true});
  }

  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(init);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  function init() {
    document.querySelectorAll('[data-adf-loyalty]').forEach(initRoot);
  }

  function initRoot(root) {
    if (root.dataset.adfLoyaltyReady === 'true') return;
    root.dataset.adfLoyaltyReady = 'true';

    if (root.dataset.adfLoyalty === 'floating') {
      setupFloating(root);
    }

    loadProgram(root);
  }

  function setupFloating(root) {
    const button = root.querySelector('.adf-loyalty-launcher');
    const popover = root.querySelector('.adf-loyalty-popover');
    if (!button || !popover) return;

    button.addEventListener('click', () => {
      popover.hidden = !popover.hidden;
    });
  }

  async function loadProgram(root) {
    const engineUrl = normalizeUrl(root.dataset.engineUrl);
    const shopDomain = normalizeShopDomain(root.dataset.shopDomain);
    const card = root.querySelector('.adf-loyalty-card');

    if (!engineUrl || !shopDomain || !card) {
      // Fail closed: there is no safe default host to fall back to, so log for
      // the merchant and show an unavailable state rather than guessing one
      // (audit M3).
      console.error(
        '[adf-loyalty] Rewards block is not configured: set the engine URL on the theme block.',
      );
      renderError(card, 'Rewards are currently unavailable.');
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const response = await fetch(
        `${engineUrl}/api/public-loyalty-program?shop=${encodeURIComponent(shopDomain)}`,
        {headers: {Accept: 'application/json'}, signal: controller.signal},
      );
      try {
        const payload = await readJson(response);
        if (!response.ok) {
          throw new Error(payload.error || 'Loyalty program could not be loaded.');
        }
        renderProgram(root, card, payload);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      renderError(
        card,
        error instanceof Error ? error.message : 'Loyalty program could not be loaded.',
      );
    }
  }

  function renderProgram(root, card, payload) {
    const settings = payload.displaySettings || {};
    const program = payload.program || {};
    const tiers = Array.isArray(program.tiers) ? program.tiers : [];
    const redemptions = Array.isArray(program.redemptions)
      ? program.redemptions.filter((item) => item.active !== false)
      : [];
    const showRedemptions = root.dataset.showRedemptions !== 'false';
    const heading = root.dataset.heading || settings.widgetTitle || 'Rewards';
    const intro =
      settings.widgetIntro ||
      'Earn points, unlock tiers, and redeem rewards at checkout.';

    card.innerHTML = [
      '<p class="adf-loyalty-eyebrow">Ama Da Flow</p>',
      `<h2 class="adf-loyalty-heading">${escapeHtml(heading)}</h2>`,
      `<p class="adf-loyalty-copy">${escapeHtml(intro)}</p>`,
      renderTiers(tiers, payload.currencyCode),
      showRedemptions ? renderRedemptions(redemptions, settings.pointsLabel) : '',
    ].join('');
  }

  function renderTiers(tiers, currencyCode) {
    if (!tiers.length) return '';
    const rows = tiers
      .map((tier) => {
        const label = tier.name || tier.label || tier.handle || 'Reward tier';
        const threshold = formatCurrency(tier.minimumValue, currencyCode);
        const benefit = tier.discountPercentage
          ? `${tier.discountPercentage}% off`
          : 'Member reward';
        return `<li class="adf-loyalty-list-item"><span>${escapeHtml(label)} at ${escapeHtml(threshold)}</span><span class="adf-loyalty-points">${escapeHtml(benefit)}</span></li>`;
      })
      .join('');
    return `<ul class="adf-loyalty-list">${rows}</ul>`;
  }

  function renderRedemptions(redemptions, pointsLabel) {
    if (!redemptions.length) return '';
    const label = pointsLabel || 'points';
    const rows = redemptions
      .map((redemption) => {
        const title = redemption.title || redemption.handle || 'Reward';
        return `<li class="adf-loyalty-list-item"><span>${escapeHtml(title)}</span><span class="adf-loyalty-points">${Number(redemption.pointsCost || 0).toLocaleString()} ${escapeHtml(label)}</span></li>`;
      })
      .join('');
    return `<ul class="adf-loyalty-list">${rows}</ul>`;
  }

  function renderError(card, message) {
    if (!card) return;
    card.innerHTML = `<p class="adf-loyalty-error">${escapeHtml(message)}</p>`;
  }

  async function readJson(response) {
    const text = await response.text();
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch {
      throw new Error('Loyalty program returned an invalid response.');
    }
  }

  function normalizeUrl(value) {
    return String(value || '').trim().replace(/\/+$/, '');
  }

  function normalizeShopDomain(value) {
    const domain = String(value || '').trim().toLowerCase();
    if (/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(domain)) {
      return domain;
    }
    return '';
  }

  function formatCurrency(value, currencyCode) {
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

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();
