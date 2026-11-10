// `prStructure`: how a PR changes the shape of the app, as plain data for `renderPrMap`.
// Pure: no file system, no git. The CLI loads both graphs, the changed files and the violations and passes them in.
// Definitions (nodes, edges, touched, affected, structural change) are in docs/proposals/pr-map.md section 4.
import { matchesAny } from '../glob.js';

/** @typedef {import('../contract/index.js').Edge} Edge */
/** @typedef {{ from: string, to: string }} FilePair */
/**
 * @typedef {object} MapNode
 * @property {string} name
 * @property {'new'|'touched'|'affected'|'nodomain'|'unchanged'} status
 * @property {number} changed   changed files in the node (new, touched, nodomain)
 * @property {number} importers files of the node importing changed code (affected)
 * @property {string[]} sample  changed files, names relative to the node's folder, in the order given
 * @property {'domain'|'layer'|'nodomain'} [kind] an untouched `nodomain` endpoint keeps its dashed look on the map
 * @property {string} [zone]  with zones: the zone the node's files belong to. Then `name` is `billing (rails)`
 * @property {string} [label] with zones: the name without the zone (`billing`)
 */
/**
 * @typedef {object} MapEdge
 * @property {string} from node name
 * @property {string} to node name
 * @property {'new'|'mutual'|'removed'|'forbidden'|'affected'} status
 * @property {string} [rule]       forbidden: the rule that fires
 * @property {FilePair[]} pairs    file imports behind the edge, sorted
 */

const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const GLOB_CHARS = /[*?{[]/;

/** Leading folders of a glob that have no wildcard: `packages/*\/src/**` → `packages`. */
export function staticPrefix(glob) {
  const parts = glob.split('/');
  const keep = [];
  for (const p of parts.slice(0, -1)) {
    if (GLOB_CHARS.test(p)) break;
    keep.push(p);
  }
  return keep.join('/');
}

/**
 * Builds the node of every file under the head `architecture.yml` (4.1).
 * @param {import('../config/index.js').Config} config
 * @param {string[]} knownFiles every file seen in the graphs and the diff: decides which layers have domains inside
 */
export function nodeResolver(config, knownFiles) {
  const layerOf = (f) => config.layers.find((l) => matchesAny(f, l.paths)) ?? null;
  const domainOf = (f) => config.domains.find((d) => matchesAny(f, d.paths)) ?? null;
  const withDomains = new Set();
  for (const f of knownFiles) {
    const l = layerOf(f);
    if (l && domainOf(f)) withDomains.add(l.name);
  }
  /** @type {Map<string, { name: string, kind: 'domain'|'layer'|'nodomain', prefix: string } | null>} */
  const cache = new Map();
  /** @param {string} file @returns {{ name: string, kind: 'domain'|'layer'|'nodomain', prefix: string } | null} null: ignored */
  return (file) => {
    if (cache.has(file)) return cache.get(file) ?? null;
    let node = null;
    if (!matchesAny(file, config.ignore ?? [])) {
      const d = domainOf(file);
      const l = layerOf(file);
      if (d) node = { name: d.name, kind: 'domain', prefix: staticPrefix(d.paths.find((p) => matchesAny(file, [p])) ?? d.paths[0]) };
      else if (l && !withDomains.has(l.name)) node = { name: l.name, kind: 'layer', prefix: staticPrefix(l.paths.find((p) => matchesAny(file, [p])) ?? l.paths[0]) };
      else if (l) {
        // inside a layer that has domains, and no domain matches: grouped by folder, at most 2 levels under the layer root
        const root = staticPrefix(l.paths.find((p) => matchesAny(file, [p])) ?? l.paths[0]);
        const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')).split('/') : [];
        const folder = dir.slice(0, root ? root.split('/').length + 2 : 2).join('/');
        node = { name: folder || '.', kind: 'nodomain', prefix: folder };
      } // else: outside every layer and every domain: not a node (this repo leaves its tests there on purpose)
    }
    cache.set(file, node);
    return node;
  };
}

/** Node edges (A → B, A ≠ B, kinds merged) with the file imports behind each. @returns {Map<string, MapEdge & { pairs: FilePair[] }>} */
function nodeEdges(edges, nodeOf, kinds) {
  const map = new Map();
  for (const e of edges) {
    const a = nodeOf(e.from);
    const b = nodeOf(e.to);
    if (!a || !b || a.name === b.name) continue;
    kinds.set(a.name, a);
    kinds.set(b.name, b);
    const k = `${a.name}\0${b.name}`;
    let m = map.get(k);
    if (!m) map.set(k, (m = { from: a.name, to: b.name, status: 'new', pairs: [] }));
    if (!m.pairs.some((p) => p.from === e.from && p.to === e.to)) m.pairs.push({ from: e.from, to: e.to });
  }
  for (const m of map.values()) m.pairs.sort((x, y) => cmp(x.from, y.from) || cmp(x.to, y.to));
  return map;
}

/**
 * @param {object} input
 * @param {Edge[]} input.baseEdges file edges of the merge base (analyzed with the head architecture.yml)
 * @param {Edge[]} input.headEdges file edges of the head
 * @param {{ path: string, status: 'A'|'M'|'D'|'R', oldPath?: string }[]} input.changed changed files (4.2)
 * @param {import('../config/index.js').Config} input.config head config
 * @param {string[]} input.baseDomainNames domains of the base architecture.yml
 * @param {{ rule: string, from: string, to?: string, files?: string[], message: string, fix: string }[]} input.newViolations violations that the PR adds
 * @param {{ file: string, importers: string[] }[]} input.impacts for each changed file, the files that import it (directly or through a barrel)
 * @param {{ label: string, sha: string }} input.base
 * @param {import('../config/index.js').Config} [input.baseConfig] base `architecture.yml`: deleted files and the old path of a rename are placed with it, so a removed domain is not "not in architecture.yml". Omitted: head config.
 * @param {Iterable<string>} [input.analyzed] files the adapter analyzes (both commits). Other changed files (docs, JSON, other
 *   languages) are not nodes: they are counted as `notAnalyzed`. Omitted: every file is analyzed.
 * @param {{ name: string, files: Iterable<string> }[]} [input.zones] groups of files the map keeps apart, in the order to draw
 *   them (the CLI passes one per language adapter when the plan has several). A domain with files in two zones is one
 *   node per zone, and an import between them is an edge. Omitted: no zones, one node per domain.
 */
export function prStructure({ baseEdges, headEdges, changed, config, baseDomainNames, newViolations, impacts, base, analyzed, baseConfig, zones }) {
  const analyzedSet = analyzed ? new Set(analyzed) : null;
  /** @type {Map<string, string>} file -> zone; a file listed in two zones stays in the first */
  const zoneOfFile = new Map();
  for (const z of zones ?? []) for (const f of z.files) if (!zoneOfFile.has(f)) zoneOfFile.set(f, z.name);
  const zoned = (resolveFn) => (f) => {
    if (analyzedSet && !analyzedSet.has(f)) return null;
    const n = resolveFn(f);
    const zone = n ? zoneOfFile.get(f) : undefined;
    return n && zone ? { ...n, name: `${n.name} (${zone})`, label: n.name, zone } : n;
  };
  const known = new Set();
  for (const e of [...baseEdges, ...headEdges]) (known.add(e.from), known.add(e.to));
  for (const c of changed) (known.add(c.path), c.oldPath && known.add(c.oldPath));
  const resolve = nodeResolver(config, [...known]);
  const nodeOf = zoned(resolve);
  const resolveBase = baseConfig ? nodeResolver(baseConfig, [...known]) : resolve;
  const baseNodeOf = zoned(resolveBase);
  const ignored = (f) => matchesAny(f, config.ignore ?? []);

  // 4.4 touched nodes: a changed file on either side. A rename touches both paths.
  /** @type {Map<string, { node: any, files: string[] }>} */
  const touched = new Map();
  const touch = (n, display) => {
    if (!n) return;
    let t = touched.get(n.name);
    if (!t) touched.set(n.name, (t = { node: n, files: [] }));
    if (!t.files.includes(display)) t.files.push(display);
  };
  let fileCount = 0;
  let notAnalyzed = 0;
  let outsideLayers = 0;
  for (const c of changed) {
    // deleted files and the old path of a rename belong to the base side: place them with the base config
    const node = c.status === 'D' ? baseNodeOf(c.path) : nodeOf(c.path);
    const oldNode = c.oldPath ? baseNodeOf(c.oldPath) : null;
    if (!node && !oldNode) {
      // ignored files are never counted; the others say why they are not on the map
      if (!ignored(c.path)) {
        if (analyzedSet && !analyzedSet.has(c.path)) notAnalyzed++;
        else outsideLayers++;
      }
      continue;
    }
    fileCount++;
    touch(node, c.path);
    if (c.oldPath) touch(oldNode, c.oldPath);
  }

  const headDomains = new Set(config.domains.map((d) => d.name));
  const newDomains = config.domains.filter((d) => !baseDomainNames.includes(d.name)).map((d) => d.name).sort();
  const removedDomains = baseDomainNames.filter((n) => !headDomains.has(n)).sort();

  // 4.3 edges
  const kinds = new Map();
  const head = nodeEdges(headEdges, nodeOf, kinds);
  const baseMap = nodeEdges(baseEdges, nodeOf, kinds);
  /** @type {Map<string, MapEdge>} */
  const edges = new Map();
  const forbiddenRule = new Map();
  for (const v of newViolations) {
    if (v.to) {
      const a = nodeOf(v.from)?.name;
      const b = nodeOf(v.to)?.name;
      if (a && b && a !== b) forbiddenRule.set(`${a}\0${b}`, v.rule);
    } else if (v.files) {
      const inCycle = new Set(v.files);
      for (const e of head.values()) if (e.pairs.some((p) => inCycle.has(p.from) && inCycle.has(p.to))) forbiddenRule.set(`${e.from}\0${e.to}`, v.rule);
    }
  }
  for (const [k, e] of head) {
    if (baseMap.has(k)) continue;
    const rule = forbiddenRule.get(k);
    edges.set(k, rule ? { ...e, status: 'forbidden', rule } : { ...e, status: 'new' });
  }
  for (const [k, e] of baseMap) if (!head.has(k)) edges.set(k, { ...e, status: 'removed' });
  // a new violation on a pair that already had an edge (another file now breaks the rule) is just as forbidden
  for (const [k, rule] of forbiddenRule) {
    const e = head.get(k);
    if (e && !edges.has(k)) edges.set(k, { ...e, status: 'forbidden', rule });
  }
  // mutual: a new allowed edge whose reverse exists in head (new or not); neither side may be forbidden
  /** @type {{ a: string, b: string, ab: FilePair, ba: FilePair }[]} */
  const mutual = [];
  for (const e of [...edges.values()]) {
    if (e.status !== 'new') continue;
    const rk = `${e.to}\0${e.from}`;
    const reverse = head.get(rk);
    if (!reverse) continue;
    const other = edges.get(rk);
    if (other && other.status === 'forbidden') continue;
    if (forbiddenRule.has(rk)) continue;
    edges.set(`${e.from}\0${e.to}`, { ...e, status: 'mutual' });
    edges.set(rk, { ...reverse, status: 'mutual' });
  }
  for (const e of edges.values()) {
    if (e.status !== 'mutual' || e.from > e.to) continue;
    const back = edges.get(`${e.to}\0${e.from}`);
    if (back) mutual.push({ a: e.from, b: e.to, ab: e.pairs[0], ba: back.pairs[0] });
  }
  mutual.sort((x, y) => cmp(x.a, y.a) || cmp(x.b, y.b));

  // affected: untouched domain/layer nodes with a file that imports a changed file
  const importersByNode = new Map();
  const seen = new Set();
  /** @type {Map<string, Set<string>>} */
  const affectedTo = new Map();
  for (const { file, importers } of impacts) {
    const target = nodeOf(file);
    for (const imp of importers) {
      const n = nodeOf(imp);
      if (!n || touched.has(n.name) || n.kind === 'nodomain') continue;
      kinds.set(n.name, n);
      if (!seen.has(imp)) {
        seen.add(imp);
        importersByNode.set(n.name, (importersByNode.get(n.name) ?? 0) + 1);
      }
      if (target && target.name !== n.name && touched.has(target.name)) {
        if (!affectedTo.has(n.name)) affectedTo.set(n.name, new Set());
        affectedTo.get(n.name)?.add(target.name);
      }
    }
  }
  for (const [from, tos] of affectedTo) {
    for (const to of tos) {
      const k = `${from}\0${to}`;
      if (!edges.has(k)) edges.set(k, { from, to, status: 'affected', pairs: [] });
    }
  }

  /** @type {Map<string, MapNode>} */
  const nodes = new Map();
  const rel = (t, f) => (t.node.prefix && f.startsWith(`${t.node.prefix}/`) ? f.slice(t.node.prefix.length + 1) : f);
  // with zones, a node carries its zone and its name without it
  const where = (n) => (n?.zone ? { zone: n.zone, label: n.label } : {});
  for (const [name, t] of touched) {
    const isNew = t.node.kind === 'domain' && newDomains.includes(t.node.label ?? name);
    const status = isNew ? 'new' : t.node.kind === 'nodomain' ? 'nodomain' : 'touched';
    nodes.set(name, { name, status, kind: t.node.kind, ...where(t.node), changed: t.files.length, importers: 0, sample: t.files.map((f) => rel(t, f)) });
  }
  for (const [name, n] of importersByNode) nodes.set(name, { name, status: 'affected', kind: kinds.get(name)?.kind, ...where(kinds.get(name)), changed: 0, importers: n, sample: [] });
  // endpoints of drawn edges that are not otherwise interesting
  for (const e of edges.values()) {
    for (const name of [e.from, e.to]) if (!nodes.has(name)) nodes.set(name, { name, status: 'unchanged', kind: kinds.get(name)?.kind, ...where(kinds.get(name)), changed: 0, importers: 0, sample: [] });
  }
  // a new domain nobody changed a file of is still new
  const drawnDomains = new Set([...nodes.values()].map((n) => n.label ?? n.name));
  for (const name of newDomains) if (!drawnDomains.has(name)) nodes.set(name, { name, status: 'new', kind: 'domain', changed: 0, importers: 0, sample: [] });

  const edgeList = [...edges.values()].sort((a, b) => cmp(a.from, b.from) || cmp(a.to, b.to));
  const structural = newDomains.length > 0 || removedDomains.length > 0 || [...nodes.values()].some((n) => n.status === 'nodomain')
    || edgeList.some((e) => e.status !== 'affected') || newViolations.length > 0;

  return {
    form: structural ? 'full' : 'short',
    base,
    fileCount,
    notAnalyzed,
    outsideLayers,
    newDomains: newDomains.map((name) => ({ name, paths: config.domains.find((d) => d.name === name)?.paths ?? [] })),
    removedDomains,
    nodes: [...nodes.values()].sort((a, b) => cmp(a.name, b.name)),
    // zones that have a node, in the order given
    zones: (zones ?? []).map((z) => z.name).filter((z) => [...nodes.values()].some((n) => n.zone === z)),
    edges: edgeList,
    mutual,
    violations: newViolations.map((v) => ({ rule: v.rule, message: v.message, fix: v.fix })),
    affectedFiles: seen.size,
  };
}
