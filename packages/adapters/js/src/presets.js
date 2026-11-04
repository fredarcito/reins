import { readFileSync, existsSync } from 'node:fs';
import { parse } from 'yaml';

export const PRESETS = Object.freeze(['vite-react', 'next-app', 'next-pages']);

/**
 * @typedef {{ description: string, layers: { name: string, paths: string[] }[], domains_from: string[], route_domains_from?: string[], entries: string[] }} Preset
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
  return parse(readFileSync(file, 'utf8'));
}
