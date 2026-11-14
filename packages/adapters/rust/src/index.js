// @agentreins/adapter-rust: Rust crates (a Cargo package or workspace, or the src-tauri/ half of a Tauri app).
// Edges come from the module tree (`mod x;`) and the paths each file names (`use crate::x`, `super::y::z()`).
// Imports from the core: only the contract.
import { CONTRACT_VERSION } from '@agentreins/core/contract';
import { detect, suggestPreset } from './detect.js';
import { graph } from './graph.js';
import { loadPreset, PRESETS } from './presets.js';

/** @type {import('@agentreins/core/contract').Adapter} */
const adapter = {
  name: 'rust',
  contract: CONTRACT_VERSION,
  detect,
  graph,
  presets: [...PRESETS],
  suggestPreset,
  loadPreset,
};

export default adapter;
export { detect, graph, loadPreset, PRESETS, suggestPreset };
