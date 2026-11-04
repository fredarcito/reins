import { existsSync } from 'node:fs';
import path from 'node:path';

const VITE_CONFIGS = ['vite.config.js', 'vite.config.mjs', 'vite.config.cjs', 'vite.config.ts', 'vite.config.mts', 'vite.config.cts'];
const NEXT_CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.cjs', 'next.config.ts', 'next.config.mts'];

/**
 * @typedef {{ framework: 'vite' | 'next', configFile: string, router?: 'app' | 'pages' | 'both', suggestedPreset: string }} Detection
 */

/**
 * Finds out whether the repo is a Vite or a Next project.
 * @param {string} repoPath
 * @returns {Detection | null}
 */
export function detectFramework(repoPath) {
  const has = (f) => existsSync(path.join(repoPath, f));
  const next = NEXT_CONFIGS.find(has);
  if (next) {
    const app = has('app') || has('src/app');
    const pages = has('pages') || has('src/pages');
    const router = app && pages ? 'both' : pages ? 'pages' : 'app';
    return { framework: 'next', configFile: next, router, suggestedPreset: router === 'pages' ? 'next-pages' : 'next-app' };
  }
  const vite = VITE_CONFIGS.find(has);
  if (vite) return { framework: 'vite', configFile: vite, suggestedPreset: 'vite-react' };
  return null;
}

/** @param {string} repoPath */
export function detect(repoPath) {
  return detectFramework(repoPath) !== null;
}

export { VITE_CONFIGS, NEXT_CONFIGS };
