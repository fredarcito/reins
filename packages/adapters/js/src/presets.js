// The presets of this adapter: one file per preset in ../presets/, each exporting a plain object.
// The same layout in every reins adapter (see docs/adapter-contract.md, "Presets").
import inertiaReact from '../presets/inertia-react.js';
import nextApp from '../presets/next-app.js';
import nextPages from '../presets/next-pages.js';
import viteReact from '../presets/vite-react.js';

const ALL = { 'vite-react': viteReact, 'next-app': nextApp, 'next-pages': nextPages, 'inertia-react': inertiaReact };

export const PRESETS = Object.freeze(Object.keys(ALL));

/**
 * @param {string} name
 * @returns {import('@agentreins/core/contract').Preset} a copy: callers may change it
 */
export function loadPreset(name) {
  if (!Object.hasOwn(ALL, name)) throw new Error(`adapter-js: unknown preset "${name}" (available: ${PRESETS.join(', ')}).`);
  return structuredClone(ALL[name]);
}
