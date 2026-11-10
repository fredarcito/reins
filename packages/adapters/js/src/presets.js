import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';

export const PRESETS = Object.freeze(['vite-react', 'next-app', 'next-pages', 'inertia-react']);

// What `reins init` needs to know about JavaScript and TypeScript, the same for every preset (a preset file may
// override a field): which files are source, which are tests, which file is a folder's public API, and which
// files nobody imports by design.
const CONVENTIONS = Object.freeze({
  sources: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
  tests: ['**/*.{test,spec,stories}.*', '**/{__tests__,__mocks__,test,tests,e2e}/**'],
  index_files: ['index.js', 'index.jsx', 'index.mjs', 'index.ts', 'index.tsx'],
  orphans_ignore: ['**/?*.config.*', '**/*.d.ts'],
  // with TypeScript sources, the rules of the drafted plan ignore type-only imports: they never run
  ignore_kinds: [{
    kind: 'type',
    if_files: ['**/*.{ts,tsx,mts,cts}'],
    unless_files: ['**/*.d.ts'],
    reason: 'TypeScript detected, so type-only imports are ignored by the rules',
  }],
});

/**
 * @typedef {{ description: string, layers: { name: string, paths: string[] }[], domains_from: string[], route_domains_from?: string[], entries: string[],
 *   sources: string[], tests: string[], index_files: string[], orphans_ignore: string[],
 *   ignore_kinds: { kind: string, if_files: string[], unless_files?: string[], reason: string }[] }} Preset
 */

/**
 * @param {string} name
 * @returns {Preset}
 */
export function loadPreset(name) {
  if (!PRESETS.includes(name)) {
    throw new Error(`adapter-js: unknown preset "${name}" (available: ${PRESETS.join(', ')}).`);
  }
  const file = new URL(`../presets/${name}.yml`, import.meta.url);
  if (!existsSync(file)) throw new Error(`adapter-js: preset file missing: presets/${name}.yml`);
  return { ...structuredClone(CONVENTIONS), ...parse(readFileSync(file, 'utf8')) };
}
