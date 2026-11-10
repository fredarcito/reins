// The impact map: for every file other code imports, how many files import it and the minimum task level if a
// change breaks them (the numbers `reins impact` prints). Built once per session in the background (resume --hook
// starts `reins impact --map`) because the graph takes seconds on large repos; the notes hook reads it in
// milliseconds and warns when a shared file is touched under a lower declared level.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEVELS, parseTriageLog, scopeSignals, suggestLevel, taskAnchor } from '@agentreins/core';
import { ARCHITECTURE_FILE, REINS_DIR } from './context.js';
import { writeFileAtomic } from './local-state.js';
import { readDoctorConfig, readText } from './project.js';
import { TRIAGE_LOG } from './triage-log.js';

export const IMPACT_MAP = `${REINS_DIR}/progress/.impact-map.json`;

/**
 * @typedef {{ consumers: number, domains: string[], level: string, reasons: string[] }} ImpactEntry
 */

/**
 * Impact of every imported file, from the graph `check` uses. Same counting as `reins impact`: importers outside the
 * file, direct or through barrels (`uses`); the level of the file plus its importers.
 * @param {string} root
 * @param {{ edges: { from: string, to: string }[], uses?: { from: string, to: string }[] }} graph
 * @param {{ name: string, paths: string[], publicApi: string[] }[]} domains
 * @returns {Record<string, ImpactEntry>}
 */
export function impactMap(root, graph, domains) {
  /** @type {Map<string, Set<string>>} */
  const importers = new Map();
  for (const e of [...graph.edges, ...(graph.uses ?? [])]) {
    if (e.from === e.to) continue;
    if (!importers.has(e.to)) importers.set(e.to, new Set());
    /** @type {Set<string>} */ (importers.get(e.to)).add(e.from);
  }
  const thresholds = readDoctorConfig(root).triage;
  /** @type {Record<string, ImpactEntry>} */
  const out = {};
  for (const [file, from] of [...importers].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const consumerDomains = scopeSignals([...from], domains, ARCHITECTURE_FILE).domains;
    const { level, reasons } = suggestLevel(scopeSignals([file, ...from], domains, ARCHITECTURE_FILE), thresholds);
    out[file] = { consumers: from.size, domains: consumerDomains, level, reasons };
  }
  return out;
}

/** Writes the map; `reins impact --map`. */
export function writeImpactMap(root, map) {
  writeFileAtomic(path.join(root, IMPACT_MAP), JSON.stringify({ files: map }));
}

/**
 * Starts `reins impact --map` detached, so the session start does not wait for the graph. Never throws.
 * @param {string} root
 */
export function buildImpactMapInBackground(root) {
  try {
    const bin = fileURLToPath(new URL('./bin.js', import.meta.url));
    spawn(process.execPath, [bin, 'impact', '--map'], { cwd: root, detached: true, stdio: 'ignore' }).unref();
  } catch {
    /* no map this session: the notes hook stays silent about impact */
  }
}

const rank = (level) => LEVELS.indexOf(level);

/**
 * The level declared for the current task of the branch: the highest among the lines that share the latest
 * line's start commit (the same window doctor uses), or the latest line's when it has none. Null without a line.
 * @param {string} root
 */
export function declaredLevel(root) {
  const text = readText(root, TRIAGE_LOG);
  if (!text) return null;
  let branch;
  try {
    branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
  const mine = parseTriageLog(text).entries.filter((e) => e.branch === branch);
  if (!mine.length) return null;
  const anchor = taskAnchor(mine, branch);
  const window = anchor ? mine.filter((e) => e.commit === anchor) : [mine[mine.length - 1]];
  return window.reduce((best, e) => (rank(e.level) > rank(best) ? e.level : best), 'small');
}

/**
 * What the notes hook says about a shared file, or null: only when the file has importers and the task has no
 * declared level, or one lower than the minimum. Silent without a map. `key` is what the hook delivers once per
 * session: per file under a declared level; per minimum level while the task is untriaged, so the reminder is
 * not repeated for every file but comes back when a file needs more.
 * @param {string} root
 * @param {string} file repo-relative
 * @returns {{ text: string, key: string } | null}
 */
export function impactHint(root, file) {
  const abs = path.join(root, IMPACT_MAP);
  if (!existsSync(abs)) return null;
  /** @type {ImpactEntry | undefined} */
  const entry = JSON.parse(readFileSync(abs, 'utf8')).files?.[file];
  if (!entry) return null;
  const declared = declaredLevel(root);
  if (declared && rank(declared) >= rank(entry.level)) return null;
  const who = `imported by ${entry.consumers} file${entry.consumers === 1 ? '' : 's'}${entry.domains.length ? ` (domains: ${entry.domains.join(', ')})` : ''}`;
  const head = `Impact of changing ${file} (from reins impact): ${who}. Minimum level if the change breaks its importers: ${entry.level} (${entry.reasons.join('; ')}).`;
  const action = declared
    ? `This task is declared ${declared}. Before editing it: tell the person the task is ${entry.level}, run \`npx reins triage ${entry.level} "<reason>"${entry.level === 'large' ? '' : ` --files ${file}`}\`${entry.level === 'large' ? ' and present the plan; wait for confirmation' : ''}. Run \`npx reins impact ${file}\` for the details.`
    : `No level is declared for this task yet: triage it first (\`npx reins triage "<reason>" --files <paths you expect to touch>\`); it is at least ${entry.level}.`;
  return { text: `${head}\n${action}`, key: declared ? `impact:${file}` : `impact:untriaged:${entry.level}` };
}
