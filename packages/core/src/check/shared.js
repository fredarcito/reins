// Helpers shared by the check rules.
import { matchesAny } from '../glob.js';

/**
 * @typedef {import('../contract/index.js').Edge} Edge
 * @typedef {import('../config/index.js').Config} Config
 * @typedef {import('../config/index.js').RuleConfig} RuleConfig
 * @typedef {{ from: string, to: string, kinds: Set<string> }} MergedEdge
 */

/**
 * @typedef {object} Violation
 * @property {string} rule
 * @property {'error'|'warn'} severity
 * @property {string} key       stable identity, used by the baseline
 * @property {string} from      file that holds the problem (importer, or first file of a cycle)
 * @property {string} [to]      imported file, when the problem is one edge
 * @property {string[]} [files] every file involved (cycles)
 * @property {string} message   why it is a problem
 * @property {string} fix       how to fix it
 */

/**
 * Merges duplicated edges: one entry per from/to pair, with every kind it was seen with.
 * @param {Edge[]} edges
 * @returns {MergedEdge[]} sorted by from, then to
 */
export function mergeEdges(edges) {
  /** @type {Map<string, MergedEdge>} */
  const map = new Map();
  for (const e of edges) {
    const k = `${e.from}\0${e.to}`;
    const m = map.get(k);
    if (m) m.kinds.add(e.kind);
    else map.set(k, { from: e.from, to: e.to, kinds: new Set([e.kind]) });
  }
  return [...map.values()].sort((a, b) => (a.from === b.from ? cmp(a.to, b.to) : cmp(a.from, b.from)));
}

/** @param {string} a @param {string} b */
export const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** An edge is ignored by a rule when every kind it has is in the rule's ignore_kinds. */
export const ignoredByKind = (/** @type {MergedEdge} */ e, /** @type {RuleConfig} */ rule) =>
  rule.ignoreKinds.length > 0 && [...e.kinds].every((k) => rule.ignoreKinds.includes(k));

/** @param {MergedEdge} e @param {string} ruleId @param {Config} config */
export const isAllowed = (e, ruleId, config) =>
  config.allow.some((a) => (!a.rule || a.rule === ruleId) && matchesAny(e.from, [a.from]) && matchesAny(e.to, [a.to]));

/** Memoized "which layer / domain does this file belong to". First match wins, in file order. */
export function classifier(/** @type {Config} */ config) {
  /** @type {Map<string, number>} */
  const layerCache = new Map();
  /** @type {Map<string, number>} */
  const domainCache = new Map();
  return {
    /** @returns {number} index in config.layers (0 = top), or -1 */
    layerIndex(file) {
      if (!layerCache.has(file)) layerCache.set(file, config.layers.findIndex((l) => matchesAny(file, l.paths)));
      return /** @type {number} */ (layerCache.get(file));
    },
    /** @returns {import('../config/index.js').Domain | undefined} */
    domain(file) {
      if (!domainCache.has(file)) domainCache.set(file, config.domains.findIndex((d) => matchesAny(file, d.paths)));
      const i = /** @type {number} */ (domainCache.get(file));
      return i === -1 ? undefined : config.domains[i];
    },
  };
}

/**
 * Replaces {name} placeholders. Unknown placeholders are left as they are.
 * @param {string} template @param {Record<string, string>} vars
 */
export const render = (template, vars) => template.replace(/\{([a-z_]+)\}/g, (m, k) => (k in vars ? vars[k] : m));
