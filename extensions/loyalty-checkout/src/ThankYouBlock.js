import {renderEarnSummary, renderSlot} from './shared.js';

export default async function render() {
  await renderSlot(renderEarnSummary, {
    heading: 'Order rewards',
    intro: 'Thanks for your order. Eligible paid orders earn points automatically.',
  });
}
