// @agentreins/adapter-rails: Ruby on Rails apps, with or without an Inertia frontend.
// Ruby has no imports: the edges come from constant references, resolved the way Zeitwerk apps use them.
// Imports from the core: only the contract.
import { CONTRACT_VERSION } from '@agentreins/core/contract';
import { detect } from './detect.js';
import { graph } from './graph.js';
import { loadPreset, PRESETS } from './presets.js';

/** @type {import('@agentreins/core/contract').Adapter} */
const adapter = {
  name: 'rails',
  contract: CONTRACT_VERSION,
  detect,
  graph,
  presets: [...PRESETS],
  suggestPreset: (repoPath) => (detect(repoPath) ? 'rails' : null),
  loadPreset,
};

export default adapter;
export { detect, graph, loadPreset, PRESETS };
