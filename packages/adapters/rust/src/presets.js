// The presets of this adapter: one file per preset in ../presets/, each exporting a plain object.
// The same layout in every reins adapter (see docs/adapter-contract.md, "Presets").
import cargo from '../presets/cargo.js';
import tauri from '../presets/tauri.js';

const ALL = { cargo, tauri };

export const PRESETS = Object.freeze(Object.keys(ALL));

/**
 * @param {string} name
 * @returns {import('@agentreins/core/contract').Preset} a copy: callers may change it
 */
export function loadPreset(name) {
  if (!Object.hasOwn(ALL, name)) throw new Error(`adapter-rust: unknown preset "${name}" (available: ${PRESETS.join(', ')}).`);
  return structuredClone(ALL[name]);
}
