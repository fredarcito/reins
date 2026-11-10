// What the architecture plan covers: files per layer and per domain, source folders outside every layer (not
// checked by layer-direction), imports between layers, exceptions and the baseline. Used by
// `reins check --coverage`, mainly as the facts behind an architecture review.
import { matchesAny } from '@agentreins/core';
import { ANY } from './init/conventions.js';

const MAX_FOLDERS = 15;

/** Top folder a file is grouped under: src/<x> inside src, otherwise the first folder. */
const folderOf = (f) => {
  const parts = f.split('/');
  return parts[0] === 'src' && parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
};

/**
 * @param {import('@agentreins/core').ArchitectureConfig} config
 * @param {{ files: string[], edges: { from: string, to: string }[] }} graph
 * @param {{ violations: { rule: string }[] }} baseline
 * @param {import('./init/conventions.js').Conventions} [lang] what is source and what is a test, from the adapters' presets
 */
export function computeCoverage(config, graph, baseline, lang = ANY) {
  const sources = graph.files.filter((f) => lang.isSource(f));
  const layerOf = new Map();
  for (const f of sources) {
    const i = config.layers.findIndex((l) => matchesAny(f, l.paths));
    if (i !== -1) layerOf.set(f, i);
  }
  const layers = config.layers.map((l, i) => ({ name: l.name, paths: l.paths, files: [...layerOf.values()].filter((x) => x === i).length }));

  const outsideCount = new Map();
  let outside = 0;
  for (const f of sources) {
    if (layerOf.has(f) || lang.isTest(f) || !f.includes('/')) continue;
    outside++;
    outsideCount.set(folderOf(f), (outsideCount.get(folderOf(f)) ?? 0) + 1);
  }
  const folders = [...outsideCount].map(([folder, files]) => ({ folder, files })).sort((a, b) => b.files - a.files || (a.folder < b.folder ? -1 : 1));

  const pairs = new Map();
  for (const e of graph.edges) {
    const a = layerOf.get(e.from);
    const b = layerOf.get(e.to);
    if (a === undefined || b === undefined || a === b) continue;
    const [hi, lo] = a < b ? [a, b] : [b, a];
    const key = `${hi}|${lo}`;
    const p = pairs.get(key) ?? { above: layers[hi].name, below: layers[lo].name, down: 0, up: 0 };
    if (a < b) p.down++;
    else p.up++;
    pairs.set(key, p);
  }

  const domains = config.domains.map((d) => {
    const own = graph.files.filter((f) => matchesAny(f, d.paths));
    return { name: d.name, paths: d.paths, files: own.length, publicApi: d.publicApi, publicApiFiles: own.filter((f) => matchesAny(f, d.publicApi)) };
  });

  const byRule = {};
  for (const v of baseline.violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;

  return {
    files: sources.length,
    layers,
    outside: { files: outside, folders },
    pairs: [...pairs.values()],
    domains,
    allow: config.allow.map((a) => ({ from: a.from, to: a.to, rule: a.rule ?? null, reason: a.reason })),
    ignore: config.ignore ?? [],
    baseline: { total: baseline.violations.length, byRule },
  };
}

/** Text for people and agents. */
export function formatCoverage(c) {
  const lines = [`reins check --coverage: what .reins/architecture.yml covers (${c.files} source files)`, ''];
  lines.push('Layers (top to bottom):');
  if (!c.layers.length) lines.push('  none: layer-direction checks nothing');
  for (const l of c.layers) lines.push(`  ${l.files ? ' ' : '!'} ${l.name.padEnd(14)} ${String(l.files).padStart(4)} files   ${l.paths.join(', ')}${l.files ? '' : '   (matches no file)'}`);
  lines.push('', `Outside every layer: ${c.outside.files} files (layer-direction doesn't check them; tests excluded)`);
  for (const f of c.outside.folders.slice(0, MAX_FOLDERS)) lines.push(`  ${f.folder}/ (${f.files})`);
  if (c.outside.folders.length > MAX_FOLDERS) lines.push(`  … and ${c.outside.folders.length - MAX_FOLDERS} more folders`);
  lines.push('', 'Imports between layers (down / up; "up" ones are violations):');
  if (!c.pairs.length) lines.push('  none');
  for (const p of c.pairs) lines.push(`  ${p.above} → ${p.below}: ${p.down} down, ${p.up} up${p.up && p.up > p.down / 3 ? '   (mixed: check this order)' : ''}`);
  lines.push('', 'Domains:');
  if (!c.domains.length) lines.push('  none: domain-boundary checks nothing');
  for (const d of c.domains) {
    const api = d.publicApiFiles.length ? d.publicApiFiles.join(', ') : `${d.publicApi.join(', ')} (matches no file)`;
    lines.push(`  ${d.files && d.publicApiFiles.length ? ' ' : '!'} ${d.name.padEnd(14)} ${String(d.files).padStart(4)} files   public API: ${api}`);
  }
  lines.push('', `Exceptions (allow): ${c.allow.length}`);
  for (const a of c.allow) lines.push(`  ${a.from} → ${a.to}${a.rule ? ` [${a.rule}]` : ''}: ${a.reason}`);
  if (c.ignore.length) lines.push('', `Ignored: ${c.ignore.join(', ')}`);
  const rules = Object.entries(c.baseline.byRule).map(([r, n]) => `${r}: ${n}`).join(', ');
  lines.push('', `Baseline: ${c.baseline.total} frozen violation(s)${rules ? ` (${rules})` : ''}. See them with \`reins check --verbose\`.`);
  return lines.join('\n');
}
