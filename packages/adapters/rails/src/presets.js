// The presets of this adapter: one file per preset in ../presets/, each exporting a plain object.
// The same layout in every reins adapter (see docs/adapter-contract.md, "Presets").
import rails from '../presets/rails.js';

const ALL = { rails };

export const PRESETS = Object.freeze(Object.keys(ALL));

/**
 * @param {string} name
 * @returns {import('@agentreins/core/contract').Preset} a copy: callers may change it
 */
export function loadPreset(name) {
  if (!Object.hasOwn(ALL, name)) throw new Error(`adapter-rails: unknown preset "${name}" (available: ${PRESETS.join(', ')}).`);
  return structuredClone(ALL[name]);
}
