/**
 * Dedicated "Reward programs" navigation entry that surfaces the existing
 * editor experience under its own URL. The editor lives in app._index.tsx;
 * this route re-exports the loader/action/component so the merchant can reach
 * it from the sidebar at /app/reward-programs without duplicating logic.
 *
 * A future split will move the editors fully here and slim app._index.tsx down
 * to a pure dashboard. Doing this re-export first keeps the navigation
 * promise without the disruptive refactor.
 */
export {loader, action, headers} from './app._index';
export {default} from './app._index';
