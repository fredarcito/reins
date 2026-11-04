// Adapter contract. The only part of core that adapters may import
// (enforced by the "exports" field of the core package).
//
// An adapter turns a repo into a list of edges "file A depends on file B".
// The core never opens a source file: it only sees these edges.

/** Version of the adapter contract implemented by this core. */
export const CONTRACT_VERSION = 1;

/**
 * Recommended values for `Edge.kind`. Adapters may use other non-empty strings;
 * rules can ignore kinds through `ignore_kinds` in architecture.yml.
 * - static:  `import x from './x'`, `export … from './x'`, `require('./x')`
 * - dynamic: `import('./x')`
 * - type:    type-only imports (`import type …`)
 */
export const EDGE_KINDS = Object.freeze(['static', 'dynamic', 'type']);

/**
 * One dependency between two files of the repo.
 * - Paths are relative to the repo root, POSIX separators, no leading "./".
 * - Only files inside the repo: external packages (node_modules, builtins) are left out.
 * @typedef {object} Edge
 * @property {string} from file that imports
 * @property {string} to   file that is imported
 * @property {string} kind see EDGE_KINDS
 */

/**
 * What graph() returns: either the edges alone, or an object with extra information.
 * - files:    every source file the adapter scanned (lets `init` find orphans)
 * - entries:  files that are entry points by convention (Next pages, main.jsx…), never orphans
 * - warnings: problems the user should see, e.g. imports that could not be resolved
 * @typedef {Edge[] | { edges: Edge[], files?: string[], entries?: string[], warnings?: string[] }} GraphResult
 */

/**
 * A finding produced by an adapter rule (same fields as a core violation, without status).
 * @typedef {{ rule: string, severity: 'error'|'warn', key: string, from: string, to?: string, files?: string[], message: string, fix: string }} AdapterViolation
 */

/**
 * @typedef {object} Adapter
 * @property {string} name     short name, e.g. "js" (matches `adapter:` in architecture.yml)
 * @property {number} contract contract version it implements (must equal CONTRACT_VERSION)
 * @property {(repoPath: string) => boolean | Promise<boolean>} detect  does this adapter apply to the repo?
 * @property {(repoPath: string, config: object) => GraphResult | Promise<GraphResult>} graph  dependency edges of the repo
 * @property {string[]} [rules] extra rule ids the adapter implements (e.g. "next-server-client")
 * @property {(repoPath: string, config: object, graph: { edges: Edge[], files: string[], entries: string[] }) => AdapterViolation[] | Promise<AdapterViolation[]>} [evaluate]
 *   runs the adapter's own rules on the normalized graph; required when `rules` is not empty
 * @property {string[]} [presets] preset names (used by `reins init`)
 * @property {(repoPath: string) => string | null} [suggestPreset] best preset for the repo, or null
 * @property {(name: string) => Preset} [loadPreset] starting point for `reins init`
 */

/**
 * @typedef {object} Preset
 * @property {string} description
 * @property {{ name: string, paths: string[] }[]} layers  candidate layers, top to bottom
 * @property {string[]} domains_from  globs of folders whose children become domains, e.g. "src/features/*"
 * @property {string[]} entries  entry-point globs
 * @property {string[]} [default_rules] adapter rules `init` should propose for this preset
 */

/**
 * Normalizes a GraphResult into one shape.
 * @param {GraphResult} result
 * @returns {{ edges: Edge[], files: string[], entries: string[], warnings: string[] }}
 */
export function normalizeGraph(result) {
  if (Array.isArray(result)) return { edges: result, files: [], entries: [], warnings: [] };
  const r = /** @type {any} */ (result ?? {});
  return { edges: r.edges, files: r.files ?? [], entries: r.entries ?? [], warnings: r.warnings ?? [] };
}

/**
 * Checks the shape of an adapter module's default export.
 * @param {unknown} adapter
 * @returns {string[]} problems, empty when valid
 */
export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object') return ['the adapter must export an object as default export'];
  const a = /** @type {Record<string, unknown>} */ (adapter);
  const problems = [];
  if (typeof a.name !== 'string' || !a.name) problems.push('"name" must be a non-empty string');
  if (!Number.isInteger(a.contract)) problems.push('"contract" must be an integer');
  else if (a.contract !== CONTRACT_VERSION) {
    problems.push(`implements contract ${a.contract}, but this core supports contract ${CONTRACT_VERSION}`);
  }
  if (typeof a.detect !== 'function') problems.push('"detect" must be a function');
  if (typeof a.graph !== 'function') problems.push('"graph" must be a function');
  if (a.rules !== undefined && !(Array.isArray(a.rules) && a.rules.every((r) => typeof r === 'string'))) {
    problems.push('"rules" must be a list of rule ids');
  }
  if (a.evaluate !== undefined && typeof a.evaluate !== 'function') problems.push('"evaluate" must be a function');
  for (const fn of ['suggestPreset', 'loadPreset']) {
    if (a[fn] !== undefined && typeof a[fn] !== 'function') problems.push(`"${fn}" must be a function`);
  }
  if (a.presets !== undefined && !(Array.isArray(a.presets) && a.presets.every((p) => typeof p === 'string'))) {
    problems.push('"presets" must be a list of preset names');
  }
  if (Array.isArray(a.rules) && a.rules.length > 0 && typeof a.evaluate !== 'function') {
    problems.push('declares "rules" but has no "evaluate" function to run them');
  }
  return problems;
}

/**
 * Checks the edges returned by an adapter. Reports at most `limit` problems.
 * @param {unknown} edges
 * @param {number} [limit]
 * @returns {string[]} problems, empty when valid
 */
export function validateEdges(edges, limit = 10) {
  if (!Array.isArray(edges)) return ['graph() must return an array of edges'];
  const problems = [];
  for (let i = 0; i < edges.length && problems.length < limit; i++) {
    const e = edges[i];
    if (!e || typeof e !== 'object') {
      problems.push(`edge ${i}: expected { from, to, kind }`);
      continue;
    }
    for (const field of ['from', 'to', 'kind']) {
      if (typeof e[field] !== 'string' || !e[field]) problems.push(`edge ${i}: "${field}" must be a non-empty string`);
    }
    for (const field of ['from', 'to']) {
      const p = e[field];
      if (typeof p === 'string' && (p.startsWith('/') || p.startsWith('./') || p.includes('\\') || /^[a-zA-Z]:/.test(p) || p.split('/').includes('..'))) {
        problems.push(`edge ${i}: "${field}" must be relative to the repo root with "/" separators ("${p}")`);
      }
    }
  }
  return problems;
}

/** Glob helper adapters may reuse (same semantics as globs in architecture.yml). */
export { matchesAny } from '../glob.js';
