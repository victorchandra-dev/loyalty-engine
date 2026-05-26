import {
  loadCustomerLoyalty,
  loadProgram,
  renderError,
  renderProgramSummary,
  renderSection,
} from './shared.js';

export default async function render() {
  const root = renderSection({loadingText: 'Loading your member rewards...'});

  try {
    const [payload, customerLoyalty] = await Promise.all([
      loadProgram(),
      loadCustomerLoyalty().catch(() => null),
    ]);
    renderProgramSummary(root, payload, {
      customerLoyalty,
      showEarnRules: true,
      showRewardsPageLink: true,
    });
  } catch (error) {
    renderError(
      root,
      error instanceof Error ? error.message : 'Loyalty rewards could not load.',
    );
  }
}
