// Pure inference for `harness init`: layers, domains and orphans from the files and edges of a repo.
// The code says what exists, not what should exist: these are drafts for a person to review.
import { matchesAny } from '@harness/core';

const SOURCE = /\.(js|jsx|mjs|cjs|ts|tsx|mts|cts)$/;
const TEST = /\.(test|spec|stories)\.[^/]+$|(^|\/)(__tests__|__mocks__|test|tests|e2e)\//;

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

/**
 * Proposes one domain per folder matching `domains_from` (e.g. every child of src/features/).
 * @param {string[]} domainsFrom globs of domain folders
 * @param {string[]} files
 * @returns {{ name: string, folder: string, paths: string[], publicApi: string[], missingIndex: boolean, files: number }[]}
 */
export function inferDomains(domainsFrom, files) {
  const folders = new Map();
  for (const f of files) {
    if (!SOURCE.test(f)) continue;
    const parts = f.split('/');
    for (let i = 1; i < parts.length; i++) {
      const dir = parts.slice(0, i).join('/');
      if (matchesAny(dir, domainsFrom)) {
        folders.set(dir, (folders.get(dir) ?? 0) + 1);
        break;
      }
    }
  }
  const used = new Set();
  return [...folders].sort(([a], [b]) => (a < b ? -1 : 1)).map(([folder, count]) => {
    const base = folder.split('/').pop().replace(/[^\w-]/g, '-');
    let name = base;
    for (let k = 2; used.has(name); k++) name = `${base}-${k}`;
    used.add(name);
    const index = files.filter((f) => new RegExp(`^${folder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/index\\.(js|jsx|mjs|ts|tsx)$`).test(f));
    return { name, folder, paths: [`${folder}/**`], publicApi: index.length ? index : [`${folder}/index.js`], missingIndex: index.length === 0, files: count };
  });
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
