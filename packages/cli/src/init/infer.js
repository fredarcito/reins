// Pure inference for `reins init`: layers, domains and orphans from the files and edges of a repo.
// The code says what exists, not what should exist: these are drafts for a person to review.
import { matchesAny } from '@agentreins/core';

const SOURCE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;
export const TEST = /\.(test|spec|stories)\.[^/]+$|(^|\/)(__tests__|__mocks__|test|tests|e2e)\//;

/**
 * @typedef {{ name: string, paths: string[], files: number }} InferredLayer
 * @typedef {{ above: string, below: string, down: number, up: number }} LayerPair
 */

/**
 * Keeps the preset layers that exist in the repo and orders them by the dominant direction of their imports:
 * if A imports B more than B imports A, A goes above B.
 * @param {{ name: string, paths: string[] }[]} presetLayers top to bottom
 * @param {string[]} files
 * @param {{ from: string, to: string, kind: string }[]} edges
 * @returns {{ layers: InferredLayer[], pairs: LayerPair[], conflicts: string[], unclassified: { folder: string, files: number }[] }}
 */
export function inferLayers(presetLayers, files, edges) {
  const sources = files.filter((f) => SOURCE.test(f));
  const kept = [];
  for (const layer of presetLayers) {
    const paths = layer.paths.filter((g) => sources.some((f) => matchesAny(f, [g])));
    if (paths.length) kept.push({ name: layer.name, paths, files: 0 });
  }
  const layerOf = new Map();
  for (const f of sources) {
    const i = kept.findIndex((l) => matchesAny(f, l.paths));
    if (i !== -1) {
      layerOf.set(f, i);
      kept[i].files++;
    }
  }

  // counts[a][b] = runtime edges from layer a to layer b
  const n = kept.length;
  const counts = Array.from({ length: n }, () => Array(n).fill(0));
  for (const e of edges) {
    if (e.kind === 'type') continue;
    const a = layerOf.get(e.from);
    const b = layerOf.get(e.to);
    if (a !== undefined && b !== undefined && a !== b) counts[a][b]++;
  }

  // Kahn's algorithm on "a above b" (a imports b more than the reverse); ties keep the preset order.
  const above = Array.from({ length: n }, () => new Set());
  const indegree = Array(n).fill(0);
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < n; b++) {
      if (counts[a][b] > counts[b][a]) {
        above[a].add(b);
        indegree[b]++;
      }
    }
  }
  const order = [];
  const ready = [...Array(n).keys()].filter((i) => indegree[i] === 0);
  while (ready.length) {
    ready.sort((x, y) => x - y);
    const i = ready.shift();
    order.push(i);
    for (const j of above[i]) if (--indegree[j] === 0) ready.push(j);
  }
  const conflicts = [];
  if (order.length < n) {
    const stuck = [...Array(n).keys()].filter((i) => !order.includes(i));
    conflicts.push(`The import directions between ${stuck.map((i) => kept[i].name).join(', ')} form a loop; their preset order was kept. Decide their order by hand.`);
    order.push(...stuck);
  }

  const layers = order.map((i) => ({ name: kept[i].name, paths: kept[i].paths, files: kept[i].files }));
  const pairs = [];
  for (let x = 0; x < order.length; x++) {
    for (let y = x + 1; y < order.length; y++) {
      const [a, b] = [order[x], order[y]];
      if (counts[a][b] || counts[b][a]) pairs.push({ above: kept[a].name, below: kept[b].name, down: counts[a][b], up: counts[b][a] });
    }
  }

  const unclassifiedCount = new Map();
  for (const f of sources) {
    if (layerOf.has(f) || TEST.test(f) || !f.includes('/')) continue;
    const parts = f.split('/');
    const folder = parts[0] === 'src' && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
    unclassifiedCount.set(folder, (unclassifiedCount.get(folder) ?? 0) + 1);
  }
  const unclassified = [...unclassifiedCount].map(([folder, count]) => ({ folder, files: count })).sort((a, b) => b.files - a.files || (a.folder < b.folder ? -1 : 1));
  return { layers, pairs, conflicts, unclassified };
}

// Route folder segments (Next conventions): `[lang]` is a parameter, not a module, so the domains are its
// children; catch-alls (`[...rest]`, `[[...slug]]`) and private folders (`_x`) are never domains.
const PARAM = /^\[[^.[\]][^\]]*\]$/;
const SKIPPED = /^(\[\[?\.\.\.|_)/;

/**
 * Proposes one domain per folder matching `domains_from` (e.g. every child of src/features/).
 * With `routes`, a matching folder that is a route parameter (`[lang]`) is looked through to its children.
 * Public API: the folder's `index.*`; for routes without one, the files imported from outside the folder plus
 * the entry points inside it (e.g. Next's page.tsx); otherwise an `index.js` placeholder flagged as missing.
 * @param {string[]} domainsFrom globs of domain folders
 * @param {string[]} files
 * @param {{ edges?: { from: string, to: string }[], entries?: string[], routes?: boolean }} [opts]
 * @returns {{ name: string, folder: string, paths: string[], publicApi: string[], missingIndex: boolean, files: number }[]}
 */
export function inferDomains(domainsFrom, files, opts = {}) {
  const { edges = [], entries = [], routes = false } = opts;
  const folders = new Map();
  for (const f of files) {
    if (!SOURCE.test(f) || (routes && TEST.test(f))) continue;
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (!matchesAny(parts.slice(0, i).join('/'), domainsFrom)) continue;
      let end = i;
      while (routes && PARAM.test(parts[end - 1]) && end < parts.length - 1) end++;
      const seg = parts[end - 1];
      const isFolder = end < parts.length;
      if (isFolder && !(routes && (SKIPPED.test(seg) || PARAM.test(seg)))) {
        const dir = parts.slice(0, end).join('/');
        folders.set(dir, (folders.get(dir) ?? 0) + 1);
      }
      break;
    }
  }
  const used = new Set();
  const entrySet = new Set(entries);
  return [...folders].sort(([a], [b]) => (a < b ? -1 : 1)).map(([folder, count]) => {
    const name = uniqueName(segmentName(folder.split('/').pop()), used);
    return { name, folder, paths: [`${folder}/**`], ...publicApiOf(folder, files, edges, entrySet, routes), files: count };
  });
}

/** `(search)` -> `search`, `tech stack` -> `tech-stack`. */
const segmentName = (seg) => seg.replace(/^\((.+)\)$/, '$1').replace(/[^\w-]/g, '-');

/** `base`, or `base-2`, `base-3`… if taken; records the name as taken. */
function uniqueName(base, used) {
  let name = base;
  for (let k = 2; used.has(name); k++) name = `${base}-${k}`;
  used.add(name);
  return name;
}

/**
 * Public API of a folder: its `index.*`; for routes without one, the files imported from outside the folder plus
 * the entry points inside it; otherwise an `index.js` placeholder flagged as missing.
 */
function publicApiOf(folder, files, edges, entrySet, routes) {
  const inside = (f) => f.startsWith(`${folder}/`);
  const index = files.filter((f) => inside(f) && /^index\.(js|jsx|mjs|ts|tsx)$/.test(f.slice(folder.length + 1)));
  // a route folder rarely has an index: its public API is what the router (or the framework) reaches
  const reached = routes && !index.length
    ? [...new Set([...edges.filter((e) => inside(e.to) && !inside(e.from)).map((e) => e.to), ...files.filter((f) => inside(f) && entrySet.has(f))])].sort()
    : [];
  const publicApi = index.length ? index : reached.length ? reached : [`${folder}/index.js`];
  return { publicApi, missingIndex: !index.length && !reached.length };
}

const GROUP = /^\(.+\)$/;
/** A sub-module needs at least this many source files (a lone page.js is not worth a note). */
const MIN_SUBMODULE_FILES = 2;
/** At most this many sub-modules per domain get a note drafted; the rest are listed so they can be drafted by hand. */
export const MAX_SUBMODULES = 12;

/**
 * Parts of a route domain worth their own module note, e.g. `companies/[slug]/salaries` inside `(companies)`.
 * Route groups `(x)` and parameters `[x]` are looked through, and a chain of single folders (`companies/[slug]`)
 * is followed down to the first level with several folders; those folders are the sub-modules. Notes stack, so an
 * agent working in a sub-module reads the domain's note and the sub-module's. Sub-modules are not domains: no rules.
 * Names are `<domain>/<part>`: the note goes to `.reins/notes/<domain>/<part>.md`.
 * @param {{ name: string, folder: string }} domain
 * @param {string[]} files
 * @param {{ edges?: { from: string, to: string }[], entries?: string[], used?: Set<string>, max?: number }} [opts]
 *   `used`: names already taken (domains, other sub-modules); new names are added to it
 * @returns {{ submodules: { name: string, folder: string, paths: string[], publicApi: string[], files: number }[], more: string[] }}
 *   `more`: folders left out by `max` (fewest files first out)
 */
export function inferSubmodules(domain, files, opts = {}) {
  const { edges = [], entries = [], used = new Set(), max = MAX_SUBMODULES } = opts;
  const own = files.filter((f) => SOURCE.test(f) && !TEST.test(f) && f.startsWith(`${domain.folder}/`));
  const count = (dir) => own.filter((f) => f.startsWith(`${dir}/`)).length;
  const childDirs = (dir) => {
    const names = new Set();
    for (const f of own) {
      if (!f.startsWith(`${dir}/`)) continue;
      const rest = f.slice(dir.length + 1).split('/');
      if (rest.length > 1 && !SKIPPED.test(rest[0])) names.add(rest[0]);
    }
    return [...names].sort().map((n) => `${dir}/${n}`);
  };
  /** child folders, looking through groups and parameters */
  const expand = (dir) => childDirs(dir).flatMap((d) => {
    const seg = d.split('/').pop();
    return GROUP.test(seg) || PARAM.test(seg) ? expand(d) : [d];
  });
  let level = expand(domain.folder);
  for (let depth = 0; level.length === 1 && depth < 8; depth++) level = expand(level[0]);
  if (level.length < 2) return { submodules: [], more: [] };

  const ranked = level.map((folder) => ({ folder, files: count(folder) }))
    .filter((x) => x.files >= MIN_SUBMODULE_FILES)
    .sort((a, b) => b.files - a.files || (a.folder < b.folder ? -1 : 1));
  const kept = ranked.slice(0, max).sort((a, b) => (a.folder < b.folder ? -1 : 1));
  const entrySet = new Set(entries);
  const submodules = kept.map(({ folder, files: n }) => ({
    name: uniqueName(`${domain.name}/${segmentName(folder.split('/').pop())}`, used),
    folder,
    paths: [`${folder}/**`],
    publicApi: publicApiOf(folder, files, edges, entrySet, true).publicApi,
    files: n,
  }));
  return { submodules, more: ranked.slice(max).map((x) => x.folder) };
}

/**
 * Source files nobody imports that are not entry points, tests or config files.
 * @param {string[]} files
 * @param {string[]} entries
 * @param {{ to: string }[]} edges
 */
export function findOrphans(files, entries, edges) {
  const imported = new Set(edges.map((e) => e.to));
  const entrySet = new Set(entries);
  return files.filter(
    (f) => SOURCE.test(f) && !imported.has(f) && !entrySet.has(f) && !TEST.test(f) && !/(^|\/)[^/]+\.config\.[^/]+$/.test(f) && !f.endsWith('.d.ts'),
  );
}

/** True if the repo has TypeScript sources. */
export const hasTypeScript = (files) => files.some((f) => /\.(ts|tsx|mts|cts)$/.test(f) && !f.endsWith('.d.ts'));
