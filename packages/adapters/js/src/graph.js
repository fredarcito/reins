// Computes the dependency graph with dependency-cruiser and returns it in the contract's format.
import { readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { cruise, getAvailableTranspilers } from 'dependency-cruiser';
import { matchesAny } from '@reins/core/contract';
import { readAliases } from './aliases.js';
import { detectFramework } from './detect.js';
import { loadPreset } from './presets.js';

/** Folders never scanned. */
export const IGNORED_DIRS = ['node_modules', '.git', '.next', '.reins', 'dist', 'build', 'out', 'coverage', '.turbo', '.vercel', '.cache', 'storybook-static'];
const EXCLUDE = `(^|/)(${IGNORED_DIRS.map((d) => d.replace(/\./g, '\\.')).join('|')})(/|$)`;
const TS_FILE = /\.(ts|tsx|mts|cts)$/;

/** @param {string} p */
const toPosix = (p) => p.split(path.sep).join('/');

/** True if the repo has TypeScript sources (stops at the first one). */
function hasTypeScript(dir, depth = 0) {
  if (depth > 12) return false;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (IGNORED_DIRS.includes(entry.name)) continue;
      if (hasTypeScript(path.join(dir, entry.name), depth + 1)) return true;
    } else if (TS_FILE.test(entry.name) && !entry.name.endsWith('.d.ts')) return true;
  }
  return false;
}

/**
 * Without the `typescript` package, dependency-cruiser silently skips .ts/.tsx files, and check would pass
 * without looking at them. Fail loudly instead.
 */
function assertTypeScriptAvailable(repoPath) {
  const problem = typeScriptProblem(repoPath, Boolean(getAvailableTranspilers().find((t) => t.name === 'typescript')?.available));
  if (problem) throw new Error(problem);
}

/**
 * @param {string} repoPath
 * @param {boolean} available whether dependency-cruiser can load the typescript package
 * @returns {string | null} error message, or null when there is no problem
 */
export function typeScriptProblem(repoPath, available) {
  if (available || !hasTypeScript(repoPath)) return null;
  return (
    'adapter-js: this repo has TypeScript files, but the "typescript" package is not available, so they would be skipped silently.\n' +
    'Fix: install it in the repo (e.g. `pnpm add -D typescript`) and run again.'
  );
}

/** Imports that look local (relative, absolute or an alias-like prefix) as opposed to npm packages. */
function looksLocal(specifier, aliasNames) {
  if (/^[./]/.test(specifier)) return true;
  if (/^[~#]/.test(specifier) || specifier.startsWith('@/')) return true;
  return aliasNames.some((a) => specifier === a || specifier.startsWith(`${a}/`));
}

/** @param {string[]} dependencyTypes */
function kindOf(dependencyTypes) {
  if (dependencyTypes.includes('type-only') || dependencyTypes.includes('type-import')) return 'type';
  if (dependencyTypes.includes('dynamic-import')) return 'dynamic';
  return 'static';
}

/**
 * @param {string} repoPath
 * @param {{ preset?: string, ignore?: string[] }} [config] the parsed architecture.yml (uses `preset` and `ignore`)
 * @returns {Promise<{ edges: import('@reins/core/contract').Edge[], files: string[], entries: string[], warnings: string[] }>}
 */
export async function graph(repoPath, config = {}) {
  // Real path: symlinked workspaces resolve to real paths, which must stay inside the root (macOS /var -> /private/var).
  const root = realpathSync(path.resolve(repoPath));
  assertTypeScriptAvailable(root);
  const aliases = readAliases(root);
  const warnings = [...aliases.warnings];
  const aliasNames = Object.keys(aliases.alias).map((a) => a.replace(/\$$/, ''));

  const result = await cruise(
    ['.'],
    {
      baseDir: root,
      exclude: { path: EXCLUDE },
      doNotFollow: { path: 'node_modules' },
      tsPreCompilationDeps: true,
      // Packages that only declare "exports" (e.g. workspace packages in a monorepo) don't resolve without this,
      // and their edges would disappear. Symlinked workspaces resolve to their real path inside the repo.
      enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'require', 'node', 'default', 'types'] },
    },
    { alias: aliases.alias, modules: [...aliases.modules, 'node_modules'] },
  );
  const output = /** @type {import('dependency-cruiser').ICruiseResult} */ (result.output);

  const ignore = config.ignore ?? [];
  const ignored = (f) => ignore.length > 0 && matchesAny(f, ignore);
  const isLocalFile = (m) => !m.coreModule && !m.couldNotResolve && !/(^|\/)node_modules\//.test(m.source) && !ignored(toPosix(m.source));
  const files = output.modules.filter(isLocalFile).map((m) => toPosix(m.source)).sort();
  const edges = [];
  const unresolved = [];
  for (const m of output.modules) {
    if (!isLocalFile(m)) continue;
    for (const d of m.dependencies) {
      if (d.coreModule) continue;
      if (d.couldNotResolve) {
        if (looksLocal(d.module, aliasNames)) unresolved.push(`'${d.module}' in ${toPosix(m.source)}`);
        continue;
      }
      if (/(^|\/)node_modules\//.test(d.resolved)) continue;
      if (ignored(toPosix(d.resolved))) continue;
      edges.push({ from: toPosix(m.source), to: toPosix(d.resolved), kind: kindOf(d.dependencyTypes) });
    }
  }
  if (unresolved.length) {
    const shown = unresolved.slice(0, 5).join(', ') + (unresolved.length > 5 ? `, and ${unresolved.length - 5} more` : '');
    warnings.push(
      `${unresolved.length} local import(s) could not be resolved, so they are not checked: ${shown}. ` +
        'If they use an alias, declare it in jsconfig.json/tsconfig.json "paths" or in vite.config resolve.alias.',
    );
  }

  const presetName = config.preset ?? detectFramework(root)?.suggestedPreset;
  const entryGlobs = presetName ? loadPreset(presetName).entries : [];
  const entries = files.filter((f) => matchesAny(f, entryGlobs));
  return { edges, files, entries, warnings };
}
