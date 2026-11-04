// @harness/adapter-js: JavaScript and TypeScript projects (Vite + React, Next app and pages router).
// Plain JS/JSX projects need no TypeScript. Imports from the core: only the contract.
import { CONTRACT_VERSION } from '@harness/core/contract';
import { detect } from './detect.js';
import { graph } from './graph.js';
import * as nextServerClient from '../rules/next-server-client.js';

/** @type {import('@harness/core/contract').Adapter} */
const adapter = {
  name: 'js',
  contract: CONTRACT_VERSION,
  detect,
  graph,
  rules: [nextServerClient.id],
  evaluate(repoPath, config, graph) {
    return nextServerClient.run(repoPath, /** @type {any} */ (config), graph);
  },
};

export default adapter;
export { detectFramework } from './detect.js';
export { readAliases, parseJsonc } from './aliases.js';
export { loadPreset, PRESETS } from './presets.js';
export { graph };
