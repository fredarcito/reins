// reins init: scans the repo and drafts .reins/architecture.yml, .reins/baseline.json, a review report and
// one module note per inferred domain that has none (route domains also get one per sub-module).
// Never overwrites existing files without confirmation (or --force).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { adapterNamesOf, normalizeGraph, runCheck, emptyBaseline, createBaseline, serializeBaseline, matchesAny, notesFor, parentNoteFile, pathsInside, NOTES_DIR } from '@agentreins/core';
import { candidates as adapterPackages, guessAdapterNames, resolveAdapter } from '../adapter.js';
import { ARCHITECTURE_FILE, BASELINE_FILE, CliError, REINS_DIR, INIT_REPORT_FILE } from '../context.js';
import { analyze } from './check.js';
import { planBase, suggestBase, suggestBaseHint } from '../base.js';
import { conventions, presetsOf } from '../init/conventions.js';
import { inferLayers, inferDomains, inferSubmodules, inferOwnedFolders, importsFromOutside, findOrphans, MAX_SUBMODULES, MIN_ROUTE_FILES, mergeSmallRoutes } from '../init/infer.js';
import { renderArchitecture, renderReport } from '../init/render.js';
import { writeNoteDraft } from '../notes-draft.js';
import { loadNotes } from '../project.js';
import { MANIFEST_FILE, sync as runSync } from '../sync/index.js';

export const options = {
  preset: { type: 'string' },
  'dry-run': { type: 'boolean' },
  force: { type: 'boolean' },
};

export const help = `Usage: reins init [options]

Scans the repo and drafts .reins/architecture.yml and .reins/baseline.json, plus a report
(.reins/init-report.md) with the inferred layers, domains, cycles, doubtful dependencies and orphans.
It also drafts a module note (.reins/notes/<domain>.md) for each domain that has none, with TODO lines
for your agent to fill in. Existing notes are never touched.
The draft describes what exists; review it before committing.

Options:
  --preset <name>  Adapter preset (default: the adapter's suggestion, e.g. next-app)
  --dry-run        Print the draft and the report, write nothing
  --force          Overwrite existing files without asking`;

/** Adapter names in an existing architecture.yml; none when it can't be read as YAML. */
function declaredAdapters(text) {
  try {
    return adapterNamesOf(parseDocument(text).toJS());
  } catch {
    return [];
  }
}

/**
 * One starting plan from the presets of every adapter: layers in the adapters' order (the import graph decides the
 * final order), and every folder domains may come from. A layer name two adapters share gets the adapter's name.
 * @param {{ adapter: string, preset: import('@agentreins/core/contract').Preset | null }[]} presets
 */
export function mergePresets(presets) {
  const layers = [];
  for (const { adapter, preset } of presets) {
    for (const layer of preset?.layers ?? []) {
      const name = layers.some((l) => l.name === layer.name) ? `${adapter}-${layer.name}` : layer.name;
      layers.push({ ...layer, name });
    }
  }
  const all = (field) => presets.flatMap(({ preset }) => preset?.[field] ?? []);
  return { layers, domains_from: all('domains_from'), route_domains_from: all('route_domains_from') };
}

/**
 * @param {{ root: string, values: Record<string, any>, out: (s: string) => void, err: (s: string) => void,
 *   adapterSearchPaths?: string[], confirm?: (question: string) => Promise<boolean>, today?: string }} ctx
 * @returns {Promise<number>}
 */
export async function init(ctx) {
  const { root, values, out } = ctx;
  const date = ctx.today ?? new Date().toISOString().slice(0, 10);

  // 1. Adapters: from an existing architecture.yml, or guessed from marker files. Never installed here.
  const existing = path.join(root, ARCHITECTURE_FILE);
  const declared = existsSync(existing) ? declaredAdapters(readFileSync(existing, 'utf8')) : [];
  const names = declared.length ? declared : guessAdapterNames(root);
  if (!names.length) throw new CliError('Could not tell which adapter this repo needs (no package.json, and no Gemfile with config/application.rb). JavaScript/TypeScript and Ruby on Rails repos are supported.');
  /** @type {{ name: string, adapter: import('@agentreins/core/contract').Adapter, packageName: string }[]} */
  const loaded = [];
  const hints = [];
  const base = planBase(root); // kept when init runs again
  const suggested = suggestBase(root);
  if (suggested) hints.push(suggestBaseHint(suggested));
  for (const [i, name] of names.entries()) {
    // declared adapters, and the repo's main language, must be installed; a guessed second language joins only
    // when its adapter is installed and recognizes the repo
    if (declared.length || i === 0) {
      loaded.push({ name, ...(await resolveAdapter(root, name, { searchPaths: ctx.adapterSearchPaths })) });
      continue;
    }
    let found;
    try {
      found = await resolveAdapter(root, name, { searchPaths: ctx.adapterSearchPaths });
    } catch (e) {
      if (!(e instanceof CliError)) throw e;
      hints.push(`This repo may also have ${name} code: to check it too, install ${adapterPackages(name)[0]} and add \`${name}\` to \`adapters\`.`);
      continue;
    }
    if (await found.adapter.detect(root)) loaded.push({ name, ...found });
  }
  const detected = (await Promise.all(loaded.map(({ adapter }) => adapter.detect(root)))).every(Boolean);

  // 2. Presets: one per adapter. They carry the starting layers and what init must know about each language.
  const known = loaded.flatMap(({ adapter }) => adapter.presets ?? []);
  if (!known.length) throw new CliError(`${loaded.map((l) => l.packageName).join(' and ')} ${loaded.length > 1 ? 'have' : 'has'} no presets, so init can't draft a plan. Write ${ARCHITECTURE_FILE} by hand.`);
  if (values.preset && !known.includes(values.preset)) throw new CliError(`Unknown preset "${values.preset}" for ${loaded.map((l) => l.packageName).join(', ')} (available: ${known.join(', ')}).`);
  const picks = presetsOf(loaded, root, values.preset);
  const lang = conventions(picks.map((x) => x.preset));
  // an adapter older than this CLI: its preset does not say which files are source or tests, so the draft is rougher
  for (const [i, x] of picks.entries()) {
    if (x.preset && !x.preset.sources) hints.push(`${loaded[i].packageName} is older than this version of reins, so the draft may count tests and other files as source. Update it (\`reins update\`) and run \`reins init\` again.`);
  }
  const p = mergePresets(picks.map((x, i) => ({ adapter: loaded[i].name, preset: x.preset })));
  // with one adapter the plan names its preset; with several, each adapter detects its own (or gets --preset)
  const preset = loaded.length === 1 ? picks[0].name : values.preset ?? null;

  // 3. Graph and inference
  const graph = { edges: [], files: [], entries: [], warnings: [], barrels: [], uses: [] };
  for (const [i, { adapter }] of loaded.entries()) {
    try {
      const g = normalizeGraph(await adapter.graph(root, { ...(picks[i].name ? { preset: picks[i].name } : {}), rules: {} }));
      for (const k of Object.keys(graph)) graph[k].push(...g[k]);
    } catch (e) {
      throw new CliError(e.message);
    }
  }
  if (loaded.length > 1) for (const k of ['files', 'entries', 'barrels', 'warnings']) graph[k] = [...new Set(graph[k])];
  // edge kinds the drafted rules ignore, as each language's preset proposes (TypeScript: type-only imports)
  const ignoredKinds = lang.ignoredKinds(graph.files);
  const layerInfo = inferLayers(p.layers, graph.files, graph.edges, lang);
  // domain folders first (features/*); a repo organized by routes gets one domain per route folder instead
  let domains = inferDomains(p.domains_from, graph.files, { edges: graph.edges, entries: graph.entries, lang });
  const fromRoutes = !domains.length && Boolean(p.route_domains_from.length);
  /** @type {string[]} route folders too small to be domains */
  const smallRoutes = [];
  let doubtfulOwned = [];
  if (fromRoutes) {
    // every route folder competes for the folders it uses: a one-file route (a thin index.jsx) whose logic lives
    // in components/pages/x is a real module; a lone page that owns nothing is left out afterwards
    const candidates = inferDomains(p.route_domains_from, graph.files, { edges: graph.edges, entries: graph.entries, routes: true, minFiles: 1, lang });
    // a route's logic often lives outside its folder (components/pages/x, components/x…): the graph says where
    const owned = inferOwnedFolders(candidates, graph.files, graph.edges, layerInfo.layers, graph, lang).doubtful;
    domains = candidates.filter((d) => d.files >= MIN_ROUTE_FILES || d.owned.length);
    // small routes built on one feature folder only they use are one module (notifications + its preferences page)
    const { merged, rest } = mergeSmallRoutes(candidates.filter((d) => !domains.includes(d)), domains, graph.files, graph.edges, graph, lang);
    domains = [...domains, ...merged].sort((a, b) => (a.folder < b.folder ? -1 : 1));
    smallRoutes.push(...rest.flatMap((d) => d.folders ?? [d.folder]));
    doubtfulOwned = owned.filter((x) => domains.some((d) => d.name === x.domain));
  }
  const entrySet = new Set(graph.entries);
  const domainFacts = domains.map((d) => ({
    name: d.name,
    importedFrom: importsFromOutside(d, graph.edges),
    closed: fromRoutes && d.publicApi.every((f) => entrySet.has(f)),
  }));
  const adapterRules = loaded.flatMap(({ adapter }, i) => (picks[i].preset?.default_rules ?? []).filter((r) => (adapter.rules ?? []).includes(r)));
  const yml = renderArchitecture({ adapters: loaded.map((l) => l.name), preset, base, date, layers: layerInfo.layers, domains, ignoreKinds: ignoredKinds.map((k) => k.kind), adapterRules });

  // 4. Validate the draft by running the real analysis on it, then freeze what it finds.
  const analysis = await analyze(root, { searchPaths: ctx.adapterSearchPaths }, { configText: yml });
  const result = runCheck({ edges: analysis.graph.edges, config: analysis.config, baseline: emptyBaseline(), extra: analysis.extra });
  const baseline = serializeBaseline(createBaseline(result.violations));
  const report = renderReport({
    date, adapters: loaded.map((l, i) => ({ packageName: l.packageName, preset: picks[i].name, reason: picks[i].reason })),
    detected, layerInfo, domains, fromRoutes, result, smallRoutes, doubtfulOwned, domainFacts,
    orphans: findOrphans(graph.files, graph.entries, graph.edges, lang), warnings: graph.warnings,
    files: graph.files.length, edges: graph.edges.length, ignoredKinds,
  });

  // module notes to draft: one per inferred domain that no note covers yet and, for route domains, one per
  // sub-module (e.g. companies/[slug]/salaries) that has no note of its own; notes stack, the domain's note comes first
  const existingNotes = loadNotes(root).notes;
  const noteExists = (name) => existsSync(path.join(root, NOTES_DIR, `${name}.md`));
  const used = new Set(domains.map((d) => d.name));
  const plans = domains.map((d) => {
    const own = graph.files.filter((f) => matchesAny(f, d.paths));
    // the domain's note: one named after it, or a top-level note whose paths all lie inside it (written under
    // another name). A broader note (a whole route group, a layer) is context for many domains, not this one's.
    const sameModule = existingNotes.find((n) => !parentNoteFile(n.file) && n.file.split('/').length === 3 && pathsInside(n, d) && own.some((f) => notesFor(f, [n]).length));
    const draftDomain = !noteExists(d.name) && !sameModule;
    // parts go in the folder of the domain's note, whatever its name, so they never lack their module note
    const noteName = noteExists(d.name) || !sameModule ? d.name : sameModule.file.slice(NOTES_DIR.length + 1, -3);
    const found = fromRoutes ? inferSubmodules({ ...d, name: noteName }, graph.files, { edges: graph.edges, entries: graph.entries, used, lang }) : { submodules: [], more: [] };
    const subs = found.submodules.filter((s) => !noteExists(s.name) && !existingNotes.some((n) => n.paths.some((p) => s.folders.some((f) => p.startsWith(`${f}/`)))));
    return { domain: d, draftDomain, subs, more: found.more };
  });
  const toDraft = plans.flatMap((x) => [...(x.draftDomain ? [x.domain.name] : []), ...x.subs.map((s) => s.name)]);
  const leftOut = plans.flatMap((x) => x.more);

  if (values['dry-run']) {
    out(`--- ${ARCHITECTURE_FILE} (not written)\n${yml}`);
    out(report);
    if (toDraft.length) out(`Would draft module notes: ${toDraft.map((n) => `${NOTES_DIR}/${n}.md`).join(', ')}`);
    for (const hint of hints) out(hint);
    return 0;
  }

  // 5. Write, asking before overwriting.
  const targets = [ARCHITECTURE_FILE, BASELINE_FILE].filter((f) => existsSync(path.join(root, f)));
  if (targets.length && !values.force) {
    const question = `${targets.join(' and ')} already exist${targets.length === 1 ? 's' : ''}. Overwrite with the new draft?`;
    if (!ctx.confirm) throw new CliError(`${question}\nRe-run with --force to overwrite, or --dry-run to preview without writing.`);
    if (!(await ctx.confirm(question))) {
      out('Nothing written.');
      return 0;
    }
  }
  mkdirSync(path.join(root, REINS_DIR), { recursive: true });
  writeFileSync(path.join(root, ARCHITECTURE_FILE), yml);
  writeFileSync(path.join(root, BASELINE_FILE), baseline);
  writeFileSync(path.join(root, INIT_REPORT_FILE), report);
  const drafted = plans.flatMap(({ domain: d, draftDomain, subs }) => [
    // loose files only this domain uses go in its note (context), not in its rules
    ...(draftDomain ? [writeNoteDraft(root, { name: d.name, paths: [...d.paths, ...(d.loose ?? [])], publicApi: d.publicApi, submodules: subs }, analysis.graph, [], domains, date)] : []),
    ...subs.map((s) => writeNoteDraft(root, { name: s.name, paths: s.paths, publicApi: s.publicApi, parent: d.name }, analysis.graph, [], domains, date)),
  ].map((r) => r.file));
  // once reins install has run, keep the AGENTS.md notes index in step with the new notes
  if (drafted.length && existsSync(path.join(root, MANIFEST_FILE))) runSync(root);

  const s = result.violations.length;
  out(
    [
      `Wrote ${ARCHITECTURE_FILE} (draft), ${BASELINE_FILE} (${s} existing violation${s === 1 ? '' : 's'} frozen) and ${INIT_REPORT_FILE}.`,
      `Layers: ${layerInfo.layers.map((l) => l.name).join(' > ') || 'none'} · Domains${fromRoutes ? ' (one per route folder)' : ''}: ${domains.map((x) => x.name).join(', ') || 'none'}`,
      ...(drafted.length ? [`Module notes drafted from the code: ${drafted.join(', ')}.`] : []),
      ...(leftOut.length ? [`More than ${MAX_SUBMODULES} sub-modules in a domain; no note drafted for: ${leftOut.join(', ')}. Draft the ones worth it with \`reins notes new <folder>\`.`] : []),
      ...(domains.length ? [] : ['No domains found, so no module notes were drafted. Draft one per module folder with `reins notes new <folder>`, or declare domains in architecture.yml.']),
      ...(graph.warnings.length ? [`Warnings: ${graph.warnings.length} (see the report)`] : []),
      ...hints,
      'Next:',
      `  1. Review the plan with your agent (in Claude Code: /reins-arch), or read ${INIT_REPORT_FILE} and edit ${ARCHITECTURE_FILE}.`,
      '  2. Have your agent fill in the module notes (in Claude Code: /reins-notes).',
      '  3. `reins check --update-baseline`, then `reins check`, then commit (the pre-commit hook needs the plan).',
    ].join('\n'),
  );
  return 0;
}
