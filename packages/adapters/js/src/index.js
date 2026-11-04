// @harness/adapter-js. Phase 1 skeleton: detect/graph are implemented in phase 3.
import { CONTRACT_VERSION } from '@harness/core/contract';

export default {
  name: 'js',
  contract: CONTRACT_VERSION,
  /** @param {string} _repoPath */
  detect(_repoPath) {
    return false;
  },
  /** @param {string} _repoPath @param {unknown} _config */
  graph(_repoPath, _config) {
    throw new Error('adapter-js: graph() is not implemented yet (phase 3).');
  },
};
