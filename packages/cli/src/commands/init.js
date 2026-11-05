// reins init: scans the repo and drafts .reins/architecture.yml, .reins/baseline.json, a review report and
// one module note per inferred domain that has none (route domains also get one per sub-module).
// Never overwrites existing files without confirmation (or --force).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { normalizeGraph, runCheck, emptyBaseline, createBaseline, serializeBaseline, matchesAny, notesFor, NOTES_DIR } from '@agentreins/core';
import { guessAdapterName, resolveAdapter } from '../adapter.js';
import { ARCHITECTURE_FILE, BASELINE_FILE, CliError, REINS_DIR, INIT_REPORT_FILE } from '../context.js';
import { analyze } from './check.js';
import { inferLayers, inferDomains, inferSubmodules, findOrphans, hasTypeScript, MAX_SUBMODULES } from '../init/infer.js';
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

/**
 * @param {{ root: string, values: Record<string, any>, out: (s: string) => void, err: (s: string) => void,
 *   adapterSearchPaths?: string[], confirm?: (question: string) => Promise<boolean>, today?: string }} ctx
 * @returns {Promise<number>}
 */
export async function init(ctx) {
  const { root, values, out } = ctx;
  const date = ctx.today ?? new Date().toISOString().slice(0, 10);

  // 1. Adapter: from an existing architecture.yml, or guessed from marker files. Never installed here.
  const existing = path.join(root, ARCHITECTURE_FILE);
  const adapterName =
    (existsSync(existing) && /^adapter:\s*["']?([\w-]+)/m.exec(readFileSync(existing, 'utf8'))?.[1]) || guessAdapterName(root);
  if (!adapterName) throw new CliError('Could not tell which adapter this repo needs (no package.json found). Only JavaScript/TypeScript repos are supported for now.');
  const { adapter, packageName } = await resolveAdapter(root, adapterName, { searchPaths: ctx.adapterSearchPaths });
  const detected = await adapter.detect(root);

  // 2. Preset
  const presets = adapter.presets ?? [];
  const suggested = adapter.suggestPreset?.(root) ?? null;
  const preset = values.preset ?? suggested ?? presets[0];
  if (!preset || !adapter.loadPreset) throw new CliError(`${packageName} has no presets, so init can't draft a plan. Write ${ARCHITECTURE_FILE} by hand.`);
  if (presets.length && !presets.includes(preset)) throw new CliError(`Unknown preset "${preset}" for ${packageName} (available: ${presets.join(', ')}).`);
  const presetReason = values.preset ? 'chosen with --preset' : suggested ? 'detected' : 'default; the adapter could not detect the framework';
  const p = adapter.loadPreset(preset);

  // 3. Graph and inference
  let graph;
  try {
    graph = normalizeGraph(await adapter.graph(root, { preset, rules: {} }));
  } catch (e) {
    throw new CliError(e.message);
  }
  const typescript = hasTypeScript(graph.files);
  const layerInfo = inferLayers(p.layers, graph.files, graph.edges);
  // domain folders first (features/*); a repo organized by routes gets one domain per route folder instead
  let domains = inferDomains(p.domains_from ?? [], graph.files);
  const fromRoutes = !domains.length && Boolean(p.route_domains_from?.length);
  if (fromRoutes) domains = inferDomains(p.route_domains_from, graph.files, { edges: graph.edges, entries: graph.entries, routes: true });
  const adapterRules = (p.default_rules ?? []).filter((r) => (adapter.rules ?? []).includes(r));
  const yml = renderArchitecture({ adapter: adapterName, preset, date, layers: layerInfo.layers, domains, typescript, adapterRules });

  // 4. Validate the draft by running the real analysis on it, then freeze what it finds.
  const analysis = await analyze(root, { searchPaths: ctx.adapterSearchPaths }, { configText: yml });
  const result = runCheck({ edges: analysis.graph.edges, config: analysis.config, baseline: emptyBaseline(), extra: analysis.extra });
  const baseline = serializeBaseline(createBaseline(result.violations));
  const report = renderReport({
    date, adapterPackage: packageName, preset, presetReason, detected, layerInfo, domains, fromRoutes, result,
    orphans: findOrphans(graph.files, graph.entries, graph.edges), warnings: graph.warnings,
    files: graph.files.length, edges: graph.edges.length, typescript,
  });

  // module notes to draft: one per inferred domain that no note covers yet and, for route domains, one per
  // sub-module (e.g. companies/[slug]/salaries) that has no note of its own; notes stack, the domain's note comes first
  const existingNotes = loadNotes(root).notes;
  const noteExists = (name) => existsSync(path.join(root, NOTES_DIR, `${name}.md`));
  const used = new Set(domains.map((d) => d.name));
  const plans = domains.map((d) => {
    const own = graph.files.filter((f) => matchesAny(f, d.paths));
    const draftDomain = !noteExists(d.name) && !own.some((f) => notesFor(f, existingNotes).length);
    const found = fromRoutes ? inferSubmodules(d, graph.files, { edges: graph.edges, entries: graph.entries, used }) : { submodules: [], more: [] };
    const subs = found.submodules.filter((s) => !noteExists(s.name) && !existingNotes.some((n) => n.paths.some((p) => p.startsWith(`${s.folder}/`))));
    return { domain: d, draftDomain, subs, more: found.more };
  });
  const toDraft = plans.flatMap((x) => [...(x.draftDomain ? [x.domain.name] : []), ...x.subs.map((s) => s.name)]);
  const leftOut = plans.flatMap((x) => x.more);

  if (values['dry-run']) {
    out(`--- ${ARCHITECTURE_FILE} (not written)\n${yml}`);
    out(report);
    if (toDraft.length) out(`Would draft module notes: ${toDraft.map((n) => `${NOTES_DIR}/${n}.md`).join(', ')}`);
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
    ...(draftDomain ? [writeNoteDraft(root, { name: d.name, paths: d.paths, publicApi: d.publicApi, submodules: subs }, analysis.graph, [], domains, date)] : []),
    ...subs.map((s) => writeNoteDraft(root, { name: s.name, paths: s.paths, publicApi: s.publicApi, parent: d.name }, analysis.graph, [], domains, date)),
  ].map((r) => r.file));
  // once reins install has run, keep the AGENTS.md notes index in step with the new notes
  if (drafted.length && existsSync(path.join(root, MANIFEST_FILE))) runSync(root);

  const s = result.violations.length;
  out(
    [
      `Wrote ${ARCHITECTURE_FILE} (draft), ${BASELINE_FILE} (${s} existing violation${s === 1 ? '' : 's'} frozen) and ${INIT_REPORT_FILE}.`,
      `Layers: ${layerInfo.layers.map((l) => l.name).join(' > ') || 'none'} · Domains${fromRoutes ? ' (one per route folder)' : ''}: ${domains.map((x) => x.name).join(', ') || 'none'}`,
      ...(drafted.length ? [`Module notes drafted from the code: ${drafted.join(', ')}. Ask your agent to fill in their TODO lines (in Claude Code: /reins-notes).`] : []),
      ...(leftOut.length ? [`More than ${MAX_SUBMODULES} sub-modules in a domain; no note drafted for: ${leftOut.join(', ')}. Draft the ones worth it with \`reins notes new <folder>\`.`] : []),
      ...(domains.length ? [] : ['No domains found, so no module notes were drafted. Draft one per module folder with `reins notes new <folder>`, or declare domains in architecture.yml.']),
      ...(graph.warnings.length ? [`Warnings: ${graph.warnings.length} (see the report)`] : []),
      `Next: review ${INIT_REPORT_FILE} and adjust ${ARCHITECTURE_FILE} (in Claude Code: /reins-arch), run \`reins check --update-baseline\`, then \`reins check\`.`,
    ].join('\n'),
  );
  return 0;
}
