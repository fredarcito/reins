// reins check: architecture rules + adapter rules + integrity, compared with the baseline.
// Exit codes: 0 = no new errors, 1 = new errors, 2 = could not run (config, adapter, usage).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import {
  CORE_RULES, adapterNamesOf, parseConfig, ConfigError, runCheck, normalizeGraph, validateEdges,
  parseBaseline, emptyBaseline, createBaseline, serializeBaseline, checkIntegrity, formatText, formatJson,
} from '@agentreins/core';
import { resolveAdapter } from '../adapter.js';
import { comparison } from '../base.js';
import { ARCHITECTURE_FILE, BASELINE_FILE, CliError, isGitRepo, toRepoPath } from '../context.js';
import { sync as runSync, MANIFEST_FILE } from '../sync/index.js';
import { computeCoverage, formatCoverage } from '../coverage.js';
import { conventions, presetsOf } from '../init/conventions.js';

export const options = {
  files: { type: 'string', multiple: true },
  json: { type: 'boolean' },
  base: { type: 'string' },
  'update-baseline': { type: 'boolean' },
  verbose: { type: 'boolean' },
  coverage: { type: 'boolean' },
};

export const help = `Usage: reins check [options]

Checks the architecture rules of .reins/architecture.yml. Only violations that are not in
.reins/baseline.json fail (exit code 1).

Options:
  --files <a,b>        Only report violations involving these files (pre-commit hook). Repeatable
  --json               JSON output for agents and tools
  --base <ref>         Compare the integrity rule with this branch (default: where this branch started, then
                       $REINS_BASE, $GITHUB_BASE_REF, base: in architecture.yml, origin/HEAD, origin/main, main)
  --update-baseline    Write the current violations to baseline.json (review the diff before committing)
  --verbose            Also list violations already in the baseline
  --coverage           Show what the plan covers instead of checking: files per layer and domain, folders outside
                       every layer, imports between layers, exceptions and the baseline (with --json too)`;

/**
 * @typedef {{ adapter: import('@agentreins/core/contract').Adapter, packageName: string }} LoadedAdapter
 */

/**
 * Loads config + adapters and computes every violation. Shared by `check`, `init`, `impact`, `notes` and the PR map.
 * @param {string} root
 * @param {{ searchPaths?: string[] }} adapterOpts
 * @param {{ configText?: string, loaded?: LoadedAdapter[], config?: import('@agentreins/core').Config }} [over]
 *   `configText`: use this architecture.yml text instead of the file. `loaded` + `config`: analyze `root` with adapters and
 *   config that are already loaded (the PR map's base checkout must use the head's adapters, never the ones inside the checkout)
 * @returns {Promise<{ config: import('@agentreins/core').Config, loaded: LoadedAdapter[], graph: ReturnType<typeof normalizeGraph>, extra: any[] }>}
 */
export async function analyze(root, adapterOpts, over = {}) {
  if (over.loaded && over.config) return analyzeWith(root, over.loaded, over.config);
  const file = path.join(root, ARCHITECTURE_FILE);
  if (over.configText === undefined && !existsSync(file)) {
    throw new CliError(`${ARCHITECTURE_FILE} not found. Run \`reins init\` to draft it.`);
  }
  const text = over.configText ?? readFileSync(file, 'utf8');
  let config;
  const loaded = [];
  try {
    const names = adapterNamesOf(parseYaml(text));
    if (!names.length) parseConfig(text, { file: ARCHITECTURE_FILE }); // reports the missing or invalid adapter key properly
    for (const name of names) loaded.push(await resolveAdapter(root, name, adapterOpts));
    config = parseConfig(text, { file: ARCHITECTURE_FILE, knownRules: knownRulesOf(loaded) });
    checkPreset(config, loaded);
  } catch (e) {
    if (e instanceof ConfigError) throw new CliError(e.message);
    throw e;
  }
  return analyzeWith(root, loaded, config);
}

/** The architecture.yml text as plain data, or null when it is not valid YAML (parseConfig then reports why). */
function parseYaml(text) {
  try {
    return parseDocument(text).toJS();
  } catch {
    return null;
  }
}

/**
 * Core rules plus every adapter's rules. Two adapters declaring the same rule id would make `rules:` ambiguous.
 * @param {LoadedAdapter[]} loaded
 */
export function knownRulesOf(loaded) {
  const owner = new Map();
  for (const { adapter, packageName } of loaded) {
    for (const id of adapter.rules ?? []) {
      if (CORE_RULES.includes(id)) throw new CliError(`${packageName} declares rule "${id}", which is a core rule.`);
      if (owner.has(id)) throw new CliError(`${owner.get(id)} and ${packageName} both declare rule "${id}": a rule id must belong to one adapter.`);
      owner.set(id, packageName);
    }
  }
  return [...CORE_RULES, ...owner.keys()];
}

/**
 * With several adapters, `preset` reaches only the adapter that lists it, so a preset no adapter lists (a typo) would be
 * dropped silently. With one adapter, the adapter itself reports an unknown preset, as before.
 * @param {import('@agentreins/core').Config} config
 * @param {LoadedAdapter[]} loaded
 */
function checkPreset(config, loaded) {
  if (!config.preset || loaded.length < 2 || loaded.some(({ adapter }) => (adapter.presets ?? []).includes(config.preset))) return;
  const known = loaded.map(({ adapter }) => `${adapter.name}: ${(adapter.presets ?? []).join(', ') || 'none'}`).join('; ');
  throw new CliError(`${ARCHITECTURE_FILE}: preset "${config.preset}" is not a preset of any adapter (${known}).`);
}

/**
 * The config one adapter sees: `preset` names one adapter's preset, so the others don't get it.
 * @param {import('@agentreins/core/contract').Adapter} adapter
 * @param {import('@agentreins/core').Config} config
 */
function configFor(adapter, config) {
  if (!config.preset || config.adapters.length < 2 || (adapter.presets ?? []).includes(config.preset)) return config;
  const { preset, ...rest } = config;
  return rest;
}

/**
 * Builds each adapter's graph, runs its own rules on its own graph, and merges the results for the core.
 * @param {string} root
 * @param {LoadedAdapter[]} loaded
 * @param {import('@agentreins/core').Config} config
 */
async function analyzeWith(root, loaded, config) {
  const graph = { edges: [], files: [], entries: [], warnings: [], barrels: [], uses: [] };
  const extra = [];
  /** @type {{ name: string, files: string[] }[]} which adapter read which files (the PR map keeps languages apart) */
  const byAdapter = [];
  for (const { adapter, packageName } of loaded) {
    const own = configFor(adapter, config);
    let g;
    try {
      g = normalizeGraph(await adapter.graph(root, own));
    } catch (e) {
      throw new CliError(e.message);
    }
    const bad = validateEdges(g.edges);
    if (bad.length) throw new CliError(`${packageName} returned an invalid graph:\n${bad.map((p) => `  - ${p}`).join('\n')}`);
    for (const k of Object.keys(graph)) graph[k].push(...g[k]);
    byAdapter.push({ name: adapter.name, files: g.files });
    if (adapter.evaluate) extra.push(...(await adapter.evaluate(root, own, g)));
  }
  if (loaded.length > 1) for (const k of ['files', 'entries', 'barrels', 'warnings']) graph[k] = [...new Set(graph[k])];
  return { config, loaded, graph, extra, byAdapter };
}

/**
 * @param {string} root
 * @returns {{ baseline: import('@agentreins/core').Baseline, missing: boolean }} throws CliError when the file can't be parsed
 */
export function readBaseline(root) {
  const file = path.join(root, BASELINE_FILE);
  if (!existsSync(file)) return { baseline: emptyBaseline(), missing: true };
  try {
    return { baseline: parseBaseline(readFileSync(file, 'utf8')), missing: false };
  } catch (e) {
    throw new CliError(`${BASELINE_FILE}: ${e.message}`);
  }
}

/**
 * @param {{ root: string, cwd: string, values: Record<string, any>, out: (s: string) => void, err: (s: string) => void,
 *   adapterSearchPaths?: string[], env?: NodeJS.ProcessEnv }} ctx
 * @returns {Promise<number>}
 */
export async function check(ctx) {
  const { root, cwd, values, out, err } = ctx;
  const files = values.files?.flatMap((f) => f.split(',')).map((f) => f.trim()).filter(Boolean).map((f) => toRepoPath(root, cwd, f));
  if (values['update-baseline'] && files) throw new CliError('--update-baseline needs the whole project: run it without --files.');

  const { config, loaded, graph, extra } = await analyze(root, { searchPaths: ctx.adapterSearchPaths });
  const warnings = [...graph.warnings];

  if (values.coverage) {
    const lang = conventions(presetsOf(loaded, root, config.preset).map((p) => p.preset));
    const coverage = computeCoverage(config, graph, readBaseline(root).baseline, lang);
    out(values.json ? JSON.stringify({ ...coverage, warnings }, null, 2) : formatCoverage(coverage));
    if (!values.json) for (const w of warnings) out(`! warning  ${w}`);
    return 0;
  }

  if (values['update-baseline']) {
    const { baseline: before } = readBaseline(root);
    const next = createBaseline(runCheck({ edges: graph.edges, config, baseline: emptyBaseline(), extra }).violations);
    writeFileSync(path.join(root, BASELINE_FILE), serializeBaseline(next));
    const old = new Set(before.violations.map((v) => v.key));
    const now = new Set(next.violations.map((v) => v.key));
    const added = [...now].filter((k) => !old.has(k)).length;
    const removed = [...old].filter((k) => !now.has(k)).length;
    out(`${BASELINE_FILE} updated: ${next.violations.length} violation(s) (+${added} frozen, -${removed} fixed).`);
    if (added) out('Frozen violations are debt: the integrity rule will flag the growth in the PR. Review the diff before committing.');
    return 0;
  }

  const { baseline, missing } = readBaseline(root);
  if (missing) warnings.push(`${BASELINE_FILE} not found: every violation counts as new. Run \`reins init\` or \`reins check --update-baseline\`.`);

  const integrityRule = config.rules.integrity;
  const integrity = [];
  if (integrityRule && integrityRule.severity !== 'off') {
    if (!isGitRepo(root)) warnings.push('Not a git repository: the integrity rule was skipped.');
    else {
      // the whole branch, like the pull request: never the task's triage line (a second task must not hide the first's changes)
      const cmp = comparison(root, { explicit: values.base, env: ctx.env });
      warnings.push(...cmp.warnings);
      const baseRef = values.base ?? cmp.ref;
      if (!cmp.commit && !baseRef) warnings.push('No base branch found (tried origin/HEAD, origin/main, main…): the integrity rule was skipped. Pass --base <ref>.');
      else integrity.push(...checkIntegrity({ repoRoot: root, baseRef: baseRef ?? 'HEAD', since: cmp.commit ?? undefined, label: cmp.label, architectureFile: ARCHITECTURE_FILE, baselineFile: BASELINE_FILE, severity: /** @type {'error'|'warn'} */ (integrityRule.severity) }));
    }
  }

  // integrity of generated files: only once reins sync has been adopted (a manifest exists)
  if (integrityRule && integrityRule.severity !== 'off' && existsSync(path.join(root, MANIFEST_FILE))) {
    const { divergences } = runSync(root, { check: true });
    for (const d of divergences) {
      integrity.push({
        rule: 'integrity', severity: /** @type {'error'|'warn'} */ (integrityRule.severity), key: `integrity|generated|${d}`, from: MANIFEST_FILE,
        message: `Generated file out of sync: ${d}.`,
        fix: 'Run `reins sync` and commit the result. Edit the sources in .reins/, not the generated files.',
      });
    }
  }

  const result = runCheck({ edges: graph.edges, config, baseline, extra: [...extra, ...integrity], files });
  if (values.json) out(formatJson(result, { warnings }));
  else out(formatText(result, { verbose: values.verbose, warnings }));
  return result.ok ? 0 : 1;
}
