// reins check: architecture rules + adapter rules + integrity, compared with the baseline.
// Exit codes: 0 = no new errors, 1 = new errors, 2 = could not run (config, adapter, usage).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
  CORE_RULES, parseConfig, ConfigError, runCheck, normalizeGraph, validateEdges,
  parseBaseline, emptyBaseline, createBaseline, serializeBaseline, checkIntegrity, formatText, formatJson,
} from '@reins/core';
import { resolveAdapter } from '../adapter.js';
import { ARCHITECTURE_FILE, BASELINE_FILE, CliError, isGitRepo, toRepoPath } from '../context.js';
import { sync as runSync, MANIFEST_FILE } from '../sync/index.js';

export const options = {
  files: { type: 'string', multiple: true },
  json: { type: 'boolean' },
  base: { type: 'string' },
  'update-baseline': { type: 'boolean' },
  verbose: { type: 'boolean' },
};

export const help = `Usage: reins check [options]

Checks the architecture rules of .reins/architecture.yml. Only violations that are not in
.reins/baseline.json fail (exit code 1).

Options:
  --files <a,b>        Only report violations involving these files (pre-commit hook). Repeatable
  --json               JSON output for agents and tools
  --base <ref>         Base branch for the integrity rule (default: $GITHUB_BASE_REF, origin/HEAD, origin/main, main)
  --update-baseline    Write the current violations to baseline.json (review the diff before committing)
  --verbose            Also list violations already in the baseline`;

/** First base ref that exists. */
export function pickBaseRef(root, explicit, env = process.env) {
  const list = [explicit, env.REINS_BASE, env.GITHUB_BASE_REF && `origin/${env.GITHUB_BASE_REF}`, 'origin/HEAD', 'origin/main', 'origin/master', 'main', 'master'];
  for (const ref of list.filter(Boolean)) {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], { cwd: root, stdio: 'ignore' });
      return ref;
    } catch {
      if (ref === explicit) return ref; // let integrity report that the explicit ref is missing
    }
  }
  return null;
}

/**
 * Loads config + adapter and computes every violation. Shared by `check` and `init`.
 * @param {string} root
 * @param {{ searchPaths?: string[] }} adapterOpts
 * @param {{ configText?: string }} [over] use this architecture.yml text instead of the file
 */
export async function analyze(root, adapterOpts, over = {}) {
  const file = path.join(root, ARCHITECTURE_FILE);
  if (over.configText === undefined && !existsSync(file)) {
    throw new CliError(`${ARCHITECTURE_FILE} not found. Run \`reins init\` to draft it.`);
  }
  const text = over.configText ?? readFileSync(file, 'utf8');
  const adapterName = /^adapter:\s*["']?([\w-]+)/m.exec(text)?.[1];
  let config;
  let loaded;
  try {
    if (!adapterName) parseConfig(text, { file: ARCHITECTURE_FILE }); // reports the missing adapter key properly
    loaded = await resolveAdapter(root, adapterName, adapterOpts);
    config = parseConfig(text, { file: ARCHITECTURE_FILE, knownRules: [...CORE_RULES, ...(loaded.adapter.rules ?? [])] });
  } catch (e) {
    if (e instanceof ConfigError) throw new CliError(e.message);
    throw e;
  }
  const { adapter } = loaded;
  let graph;
  try {
    graph = normalizeGraph(await adapter.graph(root, config));
  } catch (e) {
    throw new CliError(e.message);
  }
  const bad = validateEdges(graph.edges);
  if (bad.length) throw new CliError(`${loaded.packageName} returned an invalid graph:\n${bad.map((p) => `  - ${p}`).join('\n')}`);
  const extra = adapter.evaluate ? await adapter.evaluate(root, config, graph) : [];
  return { config, adapter, packageName: loaded.packageName, graph, extra };
}

/** @param {string} root */
function readBaseline(root) {
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

  const { config, graph, extra } = await analyze(root, { searchPaths: ctx.adapterSearchPaths });
  const warnings = [...graph.warnings];

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
      const baseRef = pickBaseRef(root, values.base, ctx.env);
      if (!baseRef) warnings.push('No base branch found (tried origin/HEAD, origin/main, main…): the integrity rule was skipped. Pass --base <ref>.');
      else integrity.push(...checkIntegrity({ repoRoot: root, baseRef, architectureFile: ARCHITECTURE_FILE, baselineFile: BASELINE_FILE, severity: /** @type {'error'|'warn'} */ (integrityRule.severity) }));
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
