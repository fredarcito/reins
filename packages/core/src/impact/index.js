// `impact`: the reverse of scope. Scope goes "path -> domain"; impact goes "file -> who consumes it".
// Pure: no file system, no git. The CLI loads the graph (the same one `check` uses) and passes it in.
import { matchesAny } from '../glob.js';

/** @typedef {import('../contract/index.js').Edge} Edge */
/** @typedef {{ name: string, paths: string[], publicApi: string[] }} Domain */

/**
 * Does `candidate` point at the target itself or inside it (folder targets)?
 * @param {string} candidate repo-relative path of a file of the graph
 * @param {string} target repo-relative path, file or folder, no trailing "/"
 */
function inside(candidate, target) {
  return candidate === target || candidate.startsWith(`${target}/`);
}

/** @param {string} file @param {Domain[]} domains @returns {Domain | null} */
const domainOf = (file, domains) => domains.find((d) => matchesAny(file, d.paths)) ?? null;

/**
 * What a change to `file` can reach, from the import graph alone.
 *
 * Consumers are files outside the target that import it (any import kind: a type-only import also
 * breaks when the type changes, even when the rules ignore it). A crossing is an import that reaches
 * a domain's internals instead of its public API — the same shape `domain-boundary` reports, before
 * exceptions (`allow`, `ignore_kinds`) are applied.
 *
 * Imports through barrels: an edge only reaches the barrel (`utils/index.ts`), so the files behind it would
 * show a single consumer — the barrel. The adapter's `uses` (importer -> file behind the barrels) adds those
 * importers as consumers with kind `barrel`. Crossings stay on real edges: going through a domain's public
 * API barrel is the legal path, not a bypass.
 *
 * @param {string} file target file or folder, repo-relative
 * @param {Edge[]} edges the adapter's graph
 * @param {Domain[]} domains from architecture.yml
 * @param {{ from: string, to: string }[]} [uses] the adapter's `uses`: what importers reach through barrels
 * @returns {{
 *   file: string, owner: string | null, targets: string[],
 *   consumers: { file: string, domain: string | null, kinds: string[] }[],
 *   domains: { domain: string | null, files: string[] }[],
 *   publicApi: string[],
 *   crossings: { from: string, to: string, domain: string, kinds: string[] }[],
 * }}
 */
export function impactOf(file, edges, domains, uses = []) {
  const target = file.replace(/\/$/, '');
  /** Files of the target that appear in the graph (for a folder: everything inside with edges). */
  const targets = new Set();
  /** @type {Map<string, { file: string, domain: string | null, kinds: Set<string> }>} */
  const consumers = new Map();
  /** @type {Map<string, { from: string, to: string, domain: string, kinds: Set<string> }>} */
  const crossings = new Map();
  for (const e of edges) {
    if (inside(e.from, target)) targets.add(e.from);
    if (inside(e.to, target)) targets.add(e.to);
    if (!inside(e.to, target) || inside(e.from, target)) continue; // internal imports are not consumers
    const toDomain = domainOf(e.to, domains);
    const fromDomain = domainOf(e.from, domains);
    let c = consumers.get(e.from);
    if (!c) consumers.set(e.from, (c = { file: e.from, domain: fromDomain?.name ?? null, kinds: new Set() }));
    c.kinds.add(e.kind);
    if (toDomain && fromDomain?.name !== toDomain.name && !matchesAny(e.to, toDomain.publicApi)) {
      let x = crossings.get(`${e.from}|${e.to}`);
      if (!x) crossings.set(`${e.from}|${e.to}`, (x = { from: e.from, to: e.to, domain: toDomain.name, kinds: new Set() }));
      x.kinds.add(e.kind);
    }
  }
  for (const u of uses) {
    if (!inside(u.to, target) || inside(u.from, target)) continue;
    let c = consumers.get(u.from);
    if (!c) consumers.set(u.from, (c = { file: u.from, domain: domainOf(u.from, domains)?.name ?? null, kinds: new Set() }));
    c.kinds.add('barrel');
  }

  // A public API file counts even when nobody imports it yet: changing it is what the level warns about.
  const publicApi = [...new Set([...targets, target])]
    .filter((f) => {
      const d = domainOf(f, domains);
      return d && matchesAny(f, d.publicApi);
    })
    .sort();

  /** @type {Map<string | null, string[]>} */
  const byDomain = new Map();
  for (const c of consumers.values()) byDomain.set(c.domain, [...(byDomain.get(c.domain) ?? []), c.file]);
  const groups = [...byDomain.entries()]
    .map(([domain, files]) => ({ domain, files: files.sort() }))
    .sort((a, b) => b.files.length - a.files.length || (a.domain === null) - (b.domain === null) || `${a.domain}`.localeCompare(`${b.domain}`));

  // A folder never matches a `dir/**` glob itself: it belongs to a domain when all its files do.
  const owners = new Set([...targets].map((f) => domainOf(f, domains)?.name ?? null));
  const owner = domainOf(target, domains)?.name ?? (owners.size === 1 ? [...owners][0] : null);

  return {
    file: target,
    owner,
    targets: [...targets].sort(),
    consumers: [...consumers.values()]
      .map((c) => ({ file: c.file, domain: c.domain, kinds: [...c.kinds].sort() }))
      .sort((a, b) => a.file.localeCompare(b.file)),
    domains: groups,
    publicApi,
    crossings: [...crossings.values()]
      .map((x) => ({ ...x, kinds: [...x.kinds].sort() }))
      .sort((a, b) => a.from.localeCompare(b.from)),
  };
}
