import {renderEarnSummary, renderSlot} from './shared.js';

export default async function render() {
  await renderSlot(renderEarnSummary, {
    heading: 'Ama Da Flow Rewards',
    intro: 'This checkout can earn points after payment is confirmed.',
  });
}
