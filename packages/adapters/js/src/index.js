// @agentreins/adapter-js: JavaScript and TypeScript projects (Vite + React, Next app and pages router).
// Plain JS/JSX projects need no TypeScript. Imports from the core: only the contract.
import { CONTRACT_VERSION } from '@agentreins/core/contract';
import { detect, detectFramework } from './detect.js';
import { graph } from './graph.js';
import { prepareCheckout } from './checkout.js';
import { loadPreset, PRESETS } from './presets.js';
import * as nextServerClient from '../rules/next-server-client.js';

/** @type {import('@agentreins/core/contract').Adapter} */
const adapter = {
  name: 'js',
  contract: CONTRACT_VERSION,
  detect,
  graph,
  rules: [nextServerClient.id],
  evaluate(repoPath, config, graph) {
    return nextServerClient.run(repoPath, /** @type {any} */ (config), graph);
  },
  presets: [...PRESETS],
  suggestPreset: (repoPath) => detectFramework(repoPath)?.suggestedPreset ?? null,
  loadPreset,
  prepareCheckout,
};

export default adapter;
export { detectFramework };
export { readAliases, parseJsonc } from './aliases.js';
export { loadPreset, PRESETS };
export { graph, prepareCheckout };
