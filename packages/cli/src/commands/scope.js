// reins scope <paths…>: domains, notes and the minimum task level suggested by the objective signals
// (same thresholds as the doctor's triage-mismatch, from .reins/doctor.yml).
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { UNCOVERED_FIX, describeUncovered, notesFor, scopeSignals, suggestLevel, uncoveredFolders } from '@agentreins/core';
import { ARCHITECTURE_FILE, toRepoPath } from '../context.js';
import { listRepoFiles, loadNotes, readDoctorConfig, readDomains } from '../project.js';

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage']);

export const options = { json: { type: 'boolean' } };
export const positionals = true;

export const help = `Usage: reins scope <path…> [--json]

For the files (or folders) a task will touch: the domains involved, public APIs, the notes to read, and the
minimum task level the objective signals suggest:
  small  = 1 domain and ≤ 3 files;  medium = 1 domain, more files;
  large  = 2+ domains, a public API, or architecture.yml.
Docs and tests are not counted. Thresholds and what is not counted come from .reins/doctor.yml.
A folder in no domain whose sibling folders are domains (a new feature folder left out) is named, with the fix.
reins triage --files <paths> measures the same and records the level.`;

/** Expands folders into the files they contain (repo-relative). */
export function expand(root, rel) {
  const abs = path.join(root, rel);
  if (!existsSync(abs) || !statSync(abs).isDirectory()) return [rel];
  const out = [];
  for (const name of readdirSync(abs).sort()) {
    if (SKIP.has(name)) continue;
    out.push(...expand(root, rel ? `${rel}/${name}` : name));
  }
  return out;
}

/** @param {{ root: string, cwd: string, values: Record<string, any>, positionals: string[], out: (s: string) => void }} ctx */
export async function scope(ctx) {
  const { root, cwd, values, out } = ctx;
  if (!ctx.positionals.length) {
    out(help);
    return 2;
  }
  const files = [...new Set(ctx.positionals.flatMap((p) => expand(root, toRepoPath(root, cwd, p).replace(/\/$/, ''))))].sort();
  const notesInfo = [];
  const domains = readDomains(root, notesInfo);
  const thresholds = readDoctorConfig(root).triage;
  const signals = scopeSignals(files, domains, ARCHITECTURE_FILE, thresholds.not_counted);
  const suggestion = suggestLevel(signals, thresholds);
  const { notes: all } = loadNotes(root);
  const notes = [...new Set(files.flatMap((f) => notesFor(f, all).map((n) => n.file)))];
  // a feature folder next to domain folders but in none: its files were silently domain-less (DEV-8914)
  const uncovered = uncoveredFolders({ changedFiles: files, repoFiles: listRepoFiles(root), domains, notes: all, notCounted: thresholds.not_counted });

  if (values.json) {
    out(JSON.stringify({ files, domains: signals.domains, publicApi: signals.publicApi, architecture: signals.architecture, notes, level: suggestion.level, reasons: suggestion.reasons, uncovered, warnings: notesInfo }, null, 2));
    return 0;
  }
  for (const w of notesInfo) out(`! warning  ${w}`);
  out(
    [
      `Files: ${files.length}`,
      `Domains: ${signals.domains.join(', ') || 'none'}`,
      `Public API touched: ${signals.publicApi.join(', ') || 'no'}`,
      `architecture.yml touched: ${signals.architecture ? 'yes' : 'no'}`,
      `Notes to read: ${notes.join(', ') || 'none'}`,
      `Minimum level: ${suggestion.level} (${suggestion.reasons.join('; ')})`,
    ].join('\n'),
  );
  for (const u of uncovered) out(`! warning  ${describeUncovered(u)}\n    Fix: ${UNCOVERED_FIX}`);
  return 0;
}
