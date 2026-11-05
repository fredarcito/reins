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
 * @returns {{ layers: InferredLayer[], pairs: LayerPair[], conflicts: string[],
 *   unclassified: { folder: string, files: number, importedBy: string[], imports: string[], fits: string | null }[] }}
 *   `fits`: the lowest layer an unclassified folder could join without violations, from its imports
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
  // where each unclassified folder would fit without violations: below every layer that imports it, above
  // every layer it imports
  const position = new Map(order.map((i, pos) => [i, pos]));
  const posOf = (f) => (layerOf.has(f) ? position.get(layerOf.get(f)) : undefined);
  const folderOf = (f) => {
    const parts = f.split('/');
    return parts[0] === 'src' && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
  };
  const unclassified = [...unclassifiedCount].map(([folder, count]) => {
    const inside = (f) => !layerOf.has(f) && f.includes('/') && folderOf(f) === folder;
    const importedBy = new Set();
    const imports = new Set();
    for (const e of edges) {
      if (e.kind === 'type') continue;
      if (inside(e.to) && posOf(e.from) !== undefined) importedBy.add(/** @type {number} */ (posOf(e.from)));
      if (inside(e.from) && posOf(e.to) !== undefined) imports.add(/** @type {number} */ (posOf(e.to)));
    }
    const lo = Math.max(0, ...importedBy);
    const hi = Math.min(layers.length - 1, ...imports);
    const names = (set) => [...set].sort((a, b) => a - b).map((x) => layers[x].name);
    return {
      folder,
      files: count,
      importedBy: names(importedBy),
      imports: names(imports),
      // the lowest layer that fits: shared code goes as low as its imports allow
      fits: layers.length && (importedBy.size || imports.size) && lo <= hi ? layers[hi].name : null,
    };
  }).sort((a, b) => b.files - a.files || (a.folder < b.folder ? -1 : 1));
  return { layers, pairs, conflicts, unclassified };
}

// Route folder segments (Next conventions): `[lang]` is a parameter and `(main)` a route group (routes sharing a
// layout), not modules, so the domains are their children; catch-alls (`[...rest]`, `[[...slug]]`) and private
// folders (`_x`) are never domains.
const PARAM = /^\[[^.[\]][^\]]*\]$/;
const GROUP = /^\(.+\)$/;
const SKIPPED = /^(\[\[?\.\.\.|_)/;
/**
 * Route path of a folder: groups dropped. `(main)/companies` and `(companies)/companies` are the same URL
 * (`/companies`) split across layouts, so they are one domain (or one part) with several folders.
 */
const routeKey = (dir) => dir.split('/').filter((s) => !GROUP.test(s)).join('/');
/** A route folder needs at least this many source files to be a domain (a lone page.js is not a module). */
export const MIN_ROUTE_FILES = 2;

/**
 * Proposes one domain per folder matching `domains_from` (e.g. every child of src/features/).
 * With `routes`, a matching folder that is a route parameter (`[lang]`) or a route group (`(main)`) is looked
 * through to its children; route folders with the same route path in different groups are one domain; and a
 * route with fewer than MIN_ROUTE_FILES source files is left out (its folders listed in `opts.small` when given).
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
  /** @type {Map<string, { folders: string[], count: number }>} */
  const byRoute = new Map();
  for (const [dir, n] of folders) {
    const key = routes ? routeKey(dir) : dir;
    const g = byRoute.get(key) ?? { folders: [], count: 0 };
    g.folders.push(dir);
    g.count += n;
    byRoute.set(key, g);
  }
  const used = new Set();
  const entrySet = new Set(entries);
  const sorted = [...byRoute.values()].map((g) => ({ ...g, folders: g.folders.sort() })).sort((a, b) => (a.folders[0] < b.folders[0] ? -1 : 1));
  if (routes) small.push(...sorted.filter((g) => g.count < MIN_ROUTE_FILES).flatMap((g) => g.folders));
  return sorted.filter((g) => !routes || g.count >= MIN_ROUTE_FILES).map((g) => {
    const folder = g.folders[0];
    const name = uniqueName(segmentName(folder.split('/').pop()), used);
    const apis = g.folders.map((f) => publicApiOf(f, files, edges, entrySet, routes));
    const missingIndex = apis.every((a) => a.missingIndex);
    const publicApi = missingIndex ? apis[0].publicApi : apis.filter((a) => !a.missingIndex).flatMap((a) => a.publicApi);
    return { name, folder, folders: g.folders, paths: g.folders.map((f) => `${f}/**`), publicApi, missingIndex, files: g.count, owned: [] };
  });
}

/**
 * @typedef {{ name: string, folder: string, folders?: string[], paths: string[], publicApi: string[], missingIndex: boolean, files: number,
 *   owned: { folder: string, files: number, imports: number, total?: number }[], loose?: string[] }} Domain
 *   `folder`: the first of `folders` (a route split across groups has several)
 *   `owned`: folders outside the domain folder that only it imports (see inferOwnedFolders)
 *   `loose`: single files outside every domain that only it imports: added to its note, never to its rules
 */

/** `(search)` -> `search`, `[slug]` -> `slug`, `tech stack` -> `tech-stack`. */
const segmentName = (seg) => seg.replace(/^\((.+)\)$/, '$1').replace(/^\[(.+)\]$/, '$1').replace(/[^\w-]/g, '-');

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
 * @param {{ name: string, folder: string, folders?: string[] }} domain
 * @param {string[]} files
 * @param {{ edges?: { from: string, to: string }[], entries?: string[], used?: Set<string>, max?: number }} [opts]
 *   `used`: names already taken (domains, other sub-modules); new names are added to it
 * Parts with the same route path in different groups are one part with several folders. A parameter folder with
 * files of its own (`rating/[slug]/page.js` + `index.js`, the page at `/rating/acme`) is a part too, covering
 * only those files (`[slug]/*`): its subfolders are parts of their own.
 * @returns {{ submodules: { name: string, folder: string, folders: string[], paths: string[], publicApi: string[], files: number }[], more: string[] }}
 *   `more`: folders left out by `max` (fewest files first out)
 */
export function inferSubmodules(domain, files, opts = {}) {
  const { edges = [], entries = [], used = new Set(), max = MAX_SUBMODULES } = opts;
  const roots = domain.folders ?? [domain.folder];
  const own = files.filter((f) => SOURCE.test(f) && !TEST.test(f) && roots.some((r) => f.startsWith(`${r}/`)));
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
  const directIn = (dir) => own.filter((f) => f.startsWith(`${dir}/`) && !f.slice(dir.length + 1).includes('/'));
  /**
   * Candidate parts under a folder, looking through groups and parameters. `direct`: only the files directly in
   * the folder (a parameter folder that is a page itself).
   * @returns {{ dir: string, direct: boolean }[]}
   */
  const expand = (dir) => childDirs(dir).flatMap((d) => {
    const seg = d.split('/').pop();
    if (!GROUP.test(seg) && !PARAM.test(seg)) return [{ dir: d, direct: false }];
    return [...(PARAM.test(seg) && directIn(d).length ? [{ dir: d, direct: true }] : []), ...expand(d)];
  });
  const keyOf = (x) => `${routeKey(x.dir)}${x.direct ? '/*' : ''}`;
  const keys = (level) => new Set(level.map(keyOf)).size;
  let level = roots.flatMap(expand);
  for (let depth = 0; keys(level) === 1 && !level[0].direct && depth < 8; depth++) level = level.flatMap((x) => expand(x.dir));
  if (keys(level) < 2) return { submodules: [], more: [] };

  /** @type {Map<string, { dir: string, direct: boolean }[]>} */
  const byRoute = new Map();
  for (const x of level) byRoute.set(keyOf(x), [...(byRoute.get(keyOf(x)) ?? []), x]);
  const sizeOf = (x) => (x.direct ? directIn(x.dir).length : count(x.dir));
  const ranked = [...byRoute.values()].map((xs) => ({ xs: xs.sort((a, b) => (a.dir < b.dir ? -1 : 1)), files: xs.reduce((n, x) => n + sizeOf(x), 0) }))
    .filter((g) => g.files >= MIN_SUBMODULE_FILES)
    .sort((a, b) => b.files - a.files || (a.xs[0].dir < b.xs[0].dir ? -1 : 1));
  const kept = ranked.slice(0, max).sort((a, b) => (a.xs[0].dir < b.xs[0].dir ? -1 : 1));
  const entrySet = new Set(entries);
  const submodules = kept.map(({ xs, files: n }) => ({
    name: uniqueName(`${domain.name}/${segmentName(xs[0].dir.split('/').pop())}`, used),
    folder: xs[0].dir,
    folders: xs.map((x) => x.dir),
    paths: xs.map((x) => `${x.dir}/${x.direct ? '*' : '**'}`),
    publicApi: xs.flatMap((x) => {
      const api = publicApiOf(x.dir, files, edges, entrySet, true).publicApi;
      return x.direct ? api.filter((f) => !f.slice(x.dir.length + 1).includes('/')) : api;
    }),
    files: n,
  }));
  return { submodules, more: ranked.slice(max).flatMap((g) => g.xs.map((x) => x.dir)) };
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

/** A folder (or loose file) belongs to the domain that makes at least this share of the imports into it. */
export const OWN_SHARE = 2 / 3;
/** Below OWN_SHARE, a folder where one domain still has the majority is only reported (as doubtful). */
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
 * Code outside every domain that belongs to one route domain. In a repo organized by routes, the logic of a route
 * often lives elsewhere (`components/pages/companies/`, `components/JobBoard/`, `views/x/`…), whatever its name:
 * this is decided by the import graph, never by folder names.
 *
 * - The lowest layer (`shared`: lib, utils, constants…) is shared by design and never assigned.
 * - Directly under a layer root (`src/components/`), a folder joins a domain only when every import into it
 *   comes from that domain; loose files likewise, but only into the domain's note.
 * - Deeper, a folder is split among domains only when it is organized by feature: most of what it holds is
 *   used by a single domain (`components/pages/`). Then each subfolder joins the domain that makes at least
 *   OWN_SHARE of its imports, whole: the other imports become violations (frozen in the baseline, listed in the
 *   report), and a new file in it is covered. A folder that is not organized by feature (`components/shared/`)
 *   is shared code: nothing in it is assigned.
 * - A folder needs 2+ source files; a container with no files and a single folder (`components/pages/` holding
 *   only `CompanyProfile/`) is skipped for the folder inside. Repeats until stable, so code used only by an
 *   owned folder follows it. Imports through barrels count as imports of the file behind them (`through`).
 *
 * @param {Domain[]} domains mutated: owned folders go to `paths` and `owned`, loose files to `loose` (notes only)
 * @param {string[]} files
 * @param {{ from: string, to: string }[]} edges
 * @param {{ paths: string[] }[]} layers top to bottom; the last one is shared by design
 * @param {{ barrels?: string[], uses?: { from: string, to: string }[] }} [through] from the adapter
 * @returns {{ doubtful: { folder: string, domain: string, share: number, imports: number }[] }}
 */
export function inferOwnedFolders(domains, files, edges, layers, through = {}) {
  const barrels = new Set(through.barrels ?? []);
  const sharedGlobs = layers.length > 1 ? layers[layers.length - 1].paths : [];
  const sources = files.filter((f) => SOURCE.test(f) && !TEST.test(f) && !barrels.has(f) && !matchesAny(f, sharedGlobs));
  const runtime = [...edges.filter((e) => !barrels.has(e.from) && !barrels.has(e.to)), ...(through.uses ?? [])].filter((e) => !TEST.test(e.from));
  const domainOf = (f) => domains.find((d) => matchesAny(f, d.paths));
  const roots = [...new Set(layers.slice(0, sharedGlobs.length ? -1 : undefined).flatMap((l) => l.paths.flatMap(globRoots)))];
  /** @type {Map<string, string>} loose file -> domain name */
  const looseOf = new Map();
  /** @type {Map<string, { domain: string, share: number, imports: number }>} */
  let doubtful = new Map();

  for (let round = 0; round < 5; round++) {
    const free = new Set(sources.filter((f) => !domainOf(f)));
    const ownerOf = (f) => domainOf(f)?.name ?? looseOf.get(f) ?? '';
    /** Who imports a folder or file (its free files), by domain. */
    const users = (unit, isDir) => {
      const inside = (f) => free.has(f) && (isDir ? f.startsWith(`${unit}/`) : f === unit);
      const by = new Map();
      let total = 0;
      for (const e of runtime) {
        if (!inside(e.to) || inside(e.from)) continue;
        const d = ownerOf(e.from);
        by.set(d, (by.get(d) ?? 0) + 1);
        total++;
      }
      const [top, n] = [...by].filter(([d]) => d).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0] ?? ['', 0];
      return { top, n, total, share: total ? n / total : 0 };
    };
    const childrenOf = (dir) => {
      const dirs = new Set();
      const direct = [];
      for (const f of free) {
        if (!f.startsWith(`${dir}/`)) continue;
        const rest = f.slice(dir.length + 1).split('/');
        if (rest.length === 1) direct.push(f);
        else dirs.add(`${dir}/${rest[0]}`);
      }
      return { dirs: [...dirs].sort(), direct: direct.sort() };
    };
    const filesIn = (dir) => [...free].filter((f) => f.startsWith(`${dir}/`)).length;
    let changed = false;
    doubtful = new Map();

    const assign = (dir, u) => {
      let target = dir; // skip containers holding a single folder and no files
      for (;;) {
        const { dirs, direct } = childrenOf(target);
        if (dirs.length !== 1 || direct.length) break;
        target = dirs[0];
      }
      const d = /** @type {Domain} */ (domains.find((x) => x.name === u.top));
      d.paths.push(`${target}/**`);
      d.owned.push({ folder: target, files: filesIn(target), imports: u.n, total: u.total });
      changed = true;
    };

    const visit = (dir, atRoot) => {
      const { dirs, direct } = childrenOf(dir);
      const units = [...dirs.map((x) => ({ unit: x, isDir: true })), ...direct.map((x) => ({ unit: x, isDir: false }))]
        .map((x) => ({ ...x, ...users(x.unit, x.isDir) }))
        .filter((x) => x.total > 0);
      const need = atRoot ? 1 : OWN_SHARE;
      const byFeature = atRoot || units.filter((x) => x.top && x.share >= OWN_SHARE).length * 2 > units.length;
      if (!byFeature) return false; // shared code: leave it, and everything in it, to every domain
      const taken = new Set();
      for (const x of units) {
        if (!x.top) continue;
        if (x.share >= need) {
          if (!x.isDir) {
            if (!looseOf.has(x.unit)) {
              looseOf.set(x.unit, x.top);
              changed = true;
            }
          } else if (filesIn(x.unit) >= 2) {
            assign(x.unit, x);
            taken.add(x.unit);
          }
        } else if (x.isDir && x.share > DOUBTFUL_SHARE) {
          doubtful.set(x.unit, { domain: x.top, share: x.share, imports: x.n });
        }
      }
      // a shared folder is not "doubtful": it belongs to no domain
      for (const x of dirs) if (!taken.has(x) && !visit(x, false)) doubtful.delete(x);
      return true;
    };
    for (const r of roots) visit(r, true);
    if (!changed) break;
  }

  // a loose file inside a folder that was assigned later is already covered by the folder
  for (const [f, name] of [...looseOf].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (domainOf(f)) continue;
    const d = /** @type {Domain} */ (domains.find((x) => x.name === name));
    (d.loose ??= []).push(f);
  }
  return {
    doubtful: [...doubtful]
      .filter(([dir]) => !domains.some((d) => d.owned.some((x) => x.folder === dir || x.folder.startsWith(`${dir}/`))))
      .map(([folder, x]) => ({ folder, ...x })),
  };
}

/** Imports into a domain's files from outside it. */
export const importsFromOutside = (domain, edges) => edges.filter((e) => matchesAny(e.to, domain.paths) && !matchesAny(e.from, domain.paths)).length;
