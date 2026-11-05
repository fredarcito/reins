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
  return body.split(',').map((x) => x.trim().replace(/^type\s+/, '')).filter(Boolean).map((x) => {
    const m = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(x);
    return m ? /** @type {[string, string]} */ ([m[2] ?? m[1], m[1]]) : /** @type {[string, string]} */ ([x, x]);
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
  const rest = code.replace(REEXPORT, (_m, clause, _q, spec) => {
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
  for (const m of code.matchAll(new RegExp(`(?:import|export)\\s+(?:type\\s+)?([^;'"\`]*?)\\s+from\\s*(['"])${esc}\\2`, 'g'))) {
    found = true;
    const braces = /^\{([^}]*)\}$/.exec(m[1].trim());
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
  for (const m of code.matchAll(/export\s+(?:declare\s+)?(?:default\s+)?(?:async\s+)?(?:abstract\s+)?(?:function\*?|class|const|let|var|type|interface|enum)\s+([\w$]+)/g)) names.add(m[1]);
  for (const m of code.matchAll(/export\s*\{([^}]*)\}(?!\s*from)/g)) for (const [exported] of clauseNames(m[1])) names.add(exported);
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
  const read = (f) => {
    if (!text.has(f)) {
      try {
        text.set(f, readFileSync(path.join(root, f), 'utf8'));
      } catch {
        text.set(f, '');
      }
    }
    return /** @type {string} */ (text.get(f));
  };
  /** @type {Map<string, { star: boolean, names: [string, string][], target: string | null }[]>} */
  const barrels = new Map();
  for (const f of new Set(edges.map((e) => e.to))) {
    if (!INDEX.test(f)) continue;
    const entries = parseBarrel(read(f));
    if (entries) barrels.set(f, entries.map((x) => ({ star: x.star, names: x.names, target: specs.get(f)?.get(x.spec) ?? null })));
  }

  /** Every file a barrel re-exports from, through nested barrels. */
  const allTargets = (b, depth = 0) => {
    const out = new Set();
    for (const x of barrels.get(b) ?? []) {
      if (!x.target) continue;
      if (barrels.has(x.target) && depth < MAX_DEPTH) for (const t of allTargets(x.target, depth + 1)) out.add(t);
      else out.add(x.target);
    }
    return out;
  };
  /** The file that defines `name` exported by barrel `b`, or null. */
  const resolveName = (b, name, depth = 0) => {
    if (depth > MAX_DEPTH) return null;
    for (const x of barrels.get(b) ?? []) {
      const pair = x.names.find(([exported]) => exported === name);
      if (!pair || !x.target) continue;
      if (pair[1] === '*') return null; // `export * as ns`: the namespace stands for the whole target
      return barrels.has(x.target) ? resolveName(x.target, pair[1], depth + 1) : x.target;
    }
    for (const x of barrels.get(b) ?? []) {
      if (!x.star || !x.target) continue;
      if (barrels.has(x.target)) {
        const t = resolveName(x.target, name, depth + 1);
        if (t) return t;
      } else if (declaredExports(read(x.target)).has(name)) return x.target;
    }
    return null;
  };

  const uses = new Set();
  for (const e of edges) {
    if (!barrels.has(e.to) || barrels.has(e.from)) continue;
    const viaSpecs = [...(specs.get(e.from) ?? [])].filter(([, to]) => to === e.to).map(([spec]) => spec);
    const used = new Set();
    for (const spec of viaSpecs) {
      const names = importedNames(read(e.from), spec);
      const targets = names?.map((n) => resolveName(e.to, n));
      if (!targets || targets.some((t) => !t)) {
        for (const t of allTargets(e.to)) used.add(t);
      } else for (const t of targets) used.add(/** @type {string} */ (t));
    }
    if (!viaSpecs.length) for (const t of allTargets(e.to)) used.add(t);
    for (const t of used) uses.add(`${e.from}\n${t}`);
  }
  return {
    barrels: [...barrels.keys()].sort(),
    uses: [...uses].sort().map((k) => {
      const [from, to] = k.split('\n');
      return { from, to };
    }),
  };
}
