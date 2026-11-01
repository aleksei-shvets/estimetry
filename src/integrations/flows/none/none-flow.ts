import type { Flow } from '../../../application/contracts/flow.js';

/** No spec-driven process: the plan is the estimate's parts, tasks are closed by hand. */
export const noneFlow: Flow = {
  id: 'none',
  title: 'No SDD',
  detect: () => false,
  plan: () => [],
};
