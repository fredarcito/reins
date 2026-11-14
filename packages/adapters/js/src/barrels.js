// Re-export files ("barrels", e.g. components/index.js with `export * from './Button'`). The import graph only
// says that a page imports the barrel, not which component it uses through it, so every page seems to use every
// component. This reads the barrels and their importers to find what each importer really uses.
// Only for inference (reins init): the rules keep checking the real edges.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { stripComments } from './source.js';

const REEXPORT = /export\s+(?:type\s+)?(\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"]+)\2\s*;?/g;
const DIRECTIVE = /^\s*(['"])use (?:client|server)\1\s*;?/;
const INDEX = /(^|\/)index\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;
const MAX_DEPTH = 4;

/**
 * Names in an import or export clause body (`A, B as C, type D`), as [exported, original] pairs.
 * @param {string} body
 * @returns {[string, string][]}
 */
function clauseNames(body) {
  return body.split(',').map((item) => item.trim().replace(/^type\s+/, '')).filter(Boolean).map((item) => {
    const match = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(item);
    return match ? /** @type {[string, string]} */ ([match[2] ?? match[1], match[1]]) : /** @type {[string, string]} */ ([item, item]);
  });
}

/**
 * The re-exports of a file that does nothing but re-export, or null.
 * @param {string} source
 * @returns {{ star: boolean, names: [string, string][], spec: string }[] | null}
 *   `names`: [name exported by the barrel, name in the target]; `star`: `export * from` (names unknown)
 */
export function parseBarrel(source) {
  const code = stripComments(source).replace(DIRECTIVE, '');
  const entries = [];
  const rest = code.replace(REEXPORT, (_match, clause, _quote, spec) => {
    if (clause.startsWith('*')) {
      const ns = /as\s+([\w$]+)/.exec(clause)?.[1];
      entries.push(ns ? { star: false, names: [[ns, '*']], spec } : { star: true, names: [], spec });
    } else {
      entries.push({ star: false, names: clauseNames(clause.slice(1, -1)), spec });
    }
    return '';
  });
  return entries.length && !rest.replace(/;/g, '').trim() ? entries : null;
}

/**
 * Names a file imports from a module specifier, or null when it can't tell (default or namespace imports, a
 * dynamic `import()`, `require`): then the importer is taken to use everything.
 * @param {string} source
 * @param {string} spec
 */
export function importedNames(source, spec) {
  const code = stripComments(source);
  const esc = spec.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const names = [];
  let found = false;
  for (const match of code.matchAll(new RegExp(`(?:import|export)\\s+(?:type\\s+)?([^;'"\`]*?)\\s+from\\s*(['"])${esc}\\2`, 'g'))) {
    found = true;
    const braces = /^\{([^}]*)\}$/.exec(match[1].trim());
    if (!braces) return null;
    names.push(...clauseNames(braces[1]).map(([, original]) => original));
  }
  if (!found || new RegExp(`(?:import|require)\\s*\\(\\s*(['"])${esc}\\1`).test(code)) return null;
  return names;
}

/** Names a module declares as exports (`export const A`, `export function B`, `export { C }`, `export default`). */
export function declaredExports(source) {
  const code = stripComments(source);
  const names = new Set();
  for (const match of code.matchAll(/export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([\w$]+)/g)) names.add(match[1]);
  for (const match of code.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) for (const [exported] of clauseNames(match[1])) names.add(exported);
  if (/export\s+default\b/.test(code)) names.add('default');
  return names;
}

/**
 * Barrels of the repo and what each importer uses through them.
 * @param {string} root real path of the repo
 * @param {{ from: string, to: string }[]} edges local edges
 * @param {Map<string, Map<string, string>>} specs per file: import specifier -> resolved local file
 * @returns {{ barrels: string[], uses: { from: string, to: string }[] }}
 *   `uses`: `from` uses `to` through one or more barrels (a direct edge to `to` is not repeated)
 */
export function resolveBarrels(root, edges, specs) {
  /** @type {Map<string, string>} */
  const text = new Map();
  const read = (file) => {
    if (!text.has(file)) {
      try {
        text.set(file, readFileSync(path.join(root, file), 'utf8'));
      } catch {
        text.set(file, '');
      }
    }
    return /** @type {string} */ (text.get(file));
  };
  /** @type {Map<string, { star: boolean, names: [string, string][], target: string | null }[]>} */
  const barrels = new Map();
  for (const file of new Set(edges.map((edge) => edge.to))) {
    if (!INDEX.test(file)) continue;
    const entries = parseBarrel(read(file));
    if (entries) barrels.set(file, entries.map((entry) => ({ star: entry.star, names: entry.names, target: specs.get(file)?.get(entry.spec) ?? null })));
  }

  /** Every file a barrel re-exports from, through nested barrels. */
  const allTargets = (barrel, depth = 0) => {
    const out = new Set();
    for (const entry of barrels.get(barrel) ?? []) {
      if (!entry.target) continue;
      if (barrels.has(entry.target) && depth < MAX_DEPTH) for (const reached of allTargets(entry.target, depth + 1)) out.add(reached);
      else out.add(entry.target);
    }
    return out;
  };
  /** The file that defines `name` exported by barrel `barrel`, or null. */
  const resolveName = (barrel, name, depth = 0) => {
    if (depth > MAX_DEPTH) return null;
    for (const entry of barrels.get(barrel) ?? []) {
      const pair = entry.names.find(([exported]) => exported === name);
      if (!pair || !entry.target) continue;
      if (pair[1] === '*') return null; // `export * as ns`: the namespace stands for the whole target
      return barrels.has(entry.target) ? resolveName(entry.target, pair[1], depth + 1) : entry.target;
    }
    for (const entry of barrels.get(barrel) ?? []) {
      if (!entry.star || !entry.target) continue;
      if (barrels.has(entry.target)) {
        const reached = resolveName(entry.target, name, depth + 1);
        if (reached) return reached;
      } else if (declaredExports(read(entry.target)).has(name)) return entry.target;
    }
    return null;
  };

  const uses = new Set();
  for (const edge of edges) {
    if (!barrels.has(edge.to) || barrels.has(edge.from)) continue;
    const viaSpecs = [...(specs.get(edge.from) ?? [])].filter(([, target]) => target === edge.to).map(([spec]) => spec);
    const used = new Set();
    for (const spec of viaSpecs) {
      const names = importedNames(read(edge.from), spec);
      const targets = names?.map((name) => resolveName(edge.to, name));
      if (!targets || targets.some((target) => !target)) {
        for (const target of allTargets(edge.to)) used.add(target);
      } else for (const target of targets) used.add(/** @type {string} */ (target));
    }
    if (!viaSpecs.length) for (const target of allTargets(edge.to)) used.add(target);
    for (const target of used) uses.add(`${edge.from}\n${target}`);
  }
  return {
    barrels: [...barrels.keys()].sort(),
    uses: [...uses].sort().map((key) => {
      const [from, to] = key.split('\n');
      return { from, to };
    }),
  };
}
