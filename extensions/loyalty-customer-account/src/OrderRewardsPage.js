import {
  loadCustomerLoyalty,
  loadProgram,
  renderError,
  renderProgramSummary,
  renderSection,
} from './shared.js';

export default async function render() {
  const root = renderSection({loadingText: 'Loading order rewards...'});

  try {
    const [payload, customerLoyalty] = await Promise.all([
      loadProgram(),
      loadCustomerLoyalty().catch(() => null),
    ]);
    renderProgramSummary(root, payload, {
      heading: 'Order rewards',
      intro:
        'Paid orders earn points based on the active loyalty rules for this shop.',
      customerLoyalty,
      showEarnRules: true,
      showRewardsPageLink: false,
    });
  } catch (error) {
    renderError(
      root,
      error instanceof Error ? error.message : 'Loyalty rewards could not load.',
    );
  }
}
