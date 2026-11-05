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

// Route folder segments (Next conventions): `[lang]` is a parameter and `(main)` a route group (routes sharing a
// layout), not modules, so the domains are their children; catch-alls (`[...rest]`, `[[...slug]]`) and private
// folders (`_x`) are never domains.
const PARAM = /^\[[^.[\]][^\]]*\]$/;
const GROUP = /^\(.+\)$/;
const SKIPPED = /^(\[\[?\.\.\.|_)/;
/** A route folder needs at least this many source files to be a domain (a lone page.js is not a module). */
export const MIN_ROUTE_FILES = 2;

/**
 * Proposes one domain per folder matching `domains_from` (e.g. every child of src/features/).
 * With `routes`, a matching folder that is a route parameter (`[lang]`) or a route group (`(main)`) is looked
 * through to its children, and a route folder with fewer than MIN_ROUTE_FILES source files is left out (listed
 * in `opts.small` when given).
 * Public API: the folder's `index.*`; for routes without one, the files imported from outside the folder plus
 * the entry points inside it (e.g. Next's page.tsx); otherwise an `index.js` placeholder flagged as missing.
 * @param {string[]} domainsFrom globs of domain folders
 * @param {string[]} files
 * @param {{ edges?: { from: string, to: string }[], entries?: string[], routes?: boolean, small?: string[] }} [opts]
 * @returns {Domain[]}
 */
export function inferDomains(domainsFrom, files, opts = {}) {
  const { edges = [], entries = [], routes = false, small = [] } = opts;
  const folders = new Map();
  for (const f of files) {
    if (!SOURCE.test(f) || (routes && TEST.test(f))) continue;
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      if (!matchesAny(parts.slice(0, i).join('/'), domainsFrom)) continue;
      let end = i;
      const through = (seg) => PARAM.test(seg) || GROUP.test(seg);
      while (routes && through(parts[end - 1]) && end < parts.length - 1) end++;
      const seg = parts[end - 1];
      const isFolder = end < parts.length;
      if (isFolder && !(routes && (SKIPPED.test(seg) || through(seg)))) {
        const dir = parts.slice(0, end).join('/');
        folders.set(dir, (folders.get(dir) ?? 0) + 1);
      }
      break;
    }
  }
  const used = new Set();
  const entrySet = new Set(entries);
  const sorted = [...folders].sort(([a], [b]) => (a < b ? -1 : 1));
  if (routes) small.push(...sorted.filter(([, n]) => n < MIN_ROUTE_FILES).map(([f]) => f));
  return sorted.filter(([, n]) => !routes || n >= MIN_ROUTE_FILES).map(([folder, count]) => {
    const name = uniqueName(segmentName(folder.split('/').pop()), used);
    return { name, folder, paths: [`${folder}/**`], ...publicApiOf(folder, files, edges, entrySet, routes), files: count, owned: [] };
  });
}

/**
 * @typedef {{ name: string, folder: string, paths: string[], publicApi: string[], missingIndex: boolean, files: number,
 *   owned: { folder: string, files: number, imports: number }[], loose?: string[] }} Domain
 *   `owned`: folders outside the domain folder that only it imports (see inferOwnedFolders)
 *   `loose`: single files outside every domain that only it imports: added to its note, never to its rules
 */

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

/** Below a share of 1, a folder used mostly by one domain is only reported (as doubtful) above this share: a tie is not ownership. */
export const DOUBTFUL_SHARE = 0.5;

/** Folders a layer glob starts from: `src/{lib,hooks}/**` -> `src/lib`, `src/hooks`. */
function globRoots(glob) {
  const m = /^([^{]*)\{([^}]*)\}(.*)$/.exec(glob);
  const expanded = m ? m[2].split(',').map((alt) => `${m[1]}${alt}${m[3]}`) : [glob];
  return expanded.map((g) => {
    const cut = g.search(/[*?{]/);
    const head = cut === -1 ? g : g.slice(0, cut);
    return cut === -1 ? head.replace(/\/[^/]*$/, '') : head.replace(/\/$/, '');
  });
}

/**
 * Folders outside every domain that only one domain uses. In a repo organized by routes, the logic of a route
 * often lives elsewhere (`components/pages/companies/`, `components/companies/`, `views/companies/`…), whatever
 * its name: this is decided by the import graph, never by folder names.
 * A folder belongs to a domain when it has 2+ source files and every import into it from outside it comes from
 * that domain (tests and stories don't count). The highest such folder is taken; layer roots and the folders
 * above them never are. It repeats until stable, so a folder used only by an owned folder follows it.
 * A folder where one domain has most imports, but not all, is only returned as doubtful: putting it in the
 * domain would turn the other imports into violations.
 * Files outside every folder that could be owned (`components/paginaContacto.js` next to `components/Button.js`)
 * that only one domain imports are returned in the domain's `loose`: they belong in its note (context), not in
 * its rules, since one file used once today may be shared tomorrow.
 * Imports through re-export files (`components/index.js`) count as imports of the file behind them, as the
 * adapter resolved them (`barrels`, `uses`); otherwise a barrel would make every page seem to use every component.
 * @param {Domain[]} domains mutated: owned folders are added to `paths` and `owned`, loose files to `loose`
 * @param {string[]} files
 * @param {{ from: string, to: string }[]} edges
 * @param {string[]} layerGlobs paths of every layer
 * @param {{ barrels?: string[], uses?: { from: string, to: string }[] }} [through] from the adapter
 * @returns {{ doubtful: { folder: string, domain: string, share: number, imports: number }[] }}
 */
export function inferOwnedFolders(domains, files, edges, layerGlobs, through = {}) {
  const barrels = new Set(through.barrels ?? []);
  const sources = files.filter((f) => SOURCE.test(f) && !TEST.test(f) && !barrels.has(f));
  const runtime = [...edges.filter((e) => !barrels.has(e.from) && !barrels.has(e.to)), ...(through.uses ?? [])].filter((e) => !TEST.test(e.from));
  const domainOf = (f) => domains.find((d) => matchesAny(f, d.paths));
  const roots = [...new Set(layerGlobs.flatMap(globRoots))];
  const rootOrAbove = (dir) => roots.some((r) => r === dir || r.startsWith(`${dir}/`));
  /** @type {Map<string, { domain: string, share: number, imports: number }>} */
  let mostly = new Map();
  for (let round = 0; round < 5; round++) {
    const free = sources.filter((f) => !domainOf(f));
    const dirs = new Set();
    for (const f of free) {
      const parts = f.split('/');
      for (let i = 2; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
    }
    const ordered = [...dirs].filter((d) => !rootOrAbove(d)).sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1));
    const taken = [];
    mostly = new Map();
    for (const dir of ordered) {
      if (taken.some((t) => dir.startsWith(`${t}/`))) continue;
      const inside = (f) => f.startsWith(`${dir}/`);
      const own = free.filter(inside);
      if (own.length < 2 || sources.some((f) => inside(f) && domainOf(f))) continue;
      const incoming = runtime.filter((e) => inside(e.to) && !inside(e.from));
      const by = new Map();
      for (const e of incoming) {
        const d = domainOf(e.from)?.name ?? '';
        by.set(d, (by.get(d) ?? 0) + 1);
      }
      const [top, n] = [...by].filter(([d]) => d).sort((a, b) => b[1] - a[1])[0] ?? ['', 0];
      if (!top) continue;
      const share = n / incoming.length;
      if (share === 1) {
        // a container with a single folder and no files of its own (`components/pages/` holding only
        // `CompanyProfile/`) is a convention, not the module: take the folder inside, so later siblings stay free
        let target = dir;
        for (;;) {
          const rest = own.map((f) => f.slice(target.length + 1).split('/'));
          const kids = new Set(rest.filter((r) => r.length > 1).map((r) => r[0]));
          if (kids.size !== 1 || rest.some((r) => r.length === 1)) break;
          target = `${target}/${[...kids][0]}`;
        }
        const d = /** @type {Domain} */ (domains.find((x) => x.name === top));
        d.paths.push(`${target}/**`);
        d.owned.push({ folder: target, files: own.length, imports: n });
        taken.push(dir);
      } else if (share > DOUBTFUL_SHARE) {
        mostly.set(dir, { domain: top, share, imports: n });
      }
    }
    if (!taken.length) break;
  }
  // report the deepest doubtful folders only: a parent is doubtful because of them
  const doubtful = [...mostly]
    .filter(([dir]) => ![...mostly.keys()].some((o) => o.startsWith(`${dir}/`)) && !domains.some((d) => d.owned.some((x) => x.folder.startsWith(`${dir}/`))))
    .map(([folder, x]) => ({ folder, ...x }));

  // loose files: only one domain uses them (directly, or through other loose files of that domain)
  /** @type {Map<string, string>} */
  const looseOf = new Map();
  const ownerOf = (f) => domainOf(f)?.name ?? looseOf.get(f) ?? '';
  for (let round = 0, grew = true; grew && round < 5; round++) {
    grew = false;
    for (const f of sources) {
      if (domainOf(f) || looseOf.has(f)) continue;
      const users = new Set(runtime.filter((e) => e.to === f && e.from !== f).map((e) => ownerOf(e.from)));
      if (users.size === 1 && !users.has('')) {
        looseOf.set(f, [...users][0]);
        grew = true;
      }
    }
  }
  for (const [f, name] of [...looseOf].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const d = /** @type {Domain} */ (domains.find((x) => x.name === name));
    (d.loose ??= []).push(f);
  }
  return { doubtful };
}

/** Imports into a domain's files from outside it. */
export const importsFromOutside = (domain, edges) => edges.filter((e) => matchesAny(e.to, domain.paths) && !matchesAny(e.from, domain.paths)).length;
