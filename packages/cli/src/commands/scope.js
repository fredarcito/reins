// harness scope <paths…>: domains, notes and the minimum task level suggested by the objective signals
// (same thresholds as the doctor's triage-mismatch, from .harness/doctor.yml).
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { notesFor, scopeSignals, suggestLevel } from '@harness/core';
import { ARCHITECTURE_FILE, toRepoPath } from '../context.js';
import { loadNotes, readDoctorConfig, readDomains } from '../project.js';

const SKIP = new Set(['node_modules', '.git', '.next', 'dist', 'build', 'out', 'coverage']);

export const options = { json: { type: 'boolean' } };
export const positionals = true;

export const help = `Usage: harness scope <path…> [--json]

For the files (or folders) a task will touch: the domains involved, public APIs, the notes to read, and the
minimum task level the objective signals suggest:
  small  = 1 domain and ≤ 3 files;  medium = 1 domain, more files;
  large  = 2+ domains, a public API, or architecture.yml.
Thresholds come from .harness/doctor.yml.`;

/** Expands folders into the files they contain (repo-relative). */
function expand(root, rel) {
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
  const signals = scopeSignals(files, domains, ARCHITECTURE_FILE);
  const suggestion = suggestLevel(signals, thresholds);
  const { notes: all } = loadNotes(root);
  const notes = [...new Set(files.flatMap((f) => notesFor(f, all).map((n) => n.file)))];

  if (values.json) {
    out(JSON.stringify({ files, domains: signals.domains, publicApi: signals.publicApi, architecture: signals.architecture, notes, level: suggestion.level, reasons: suggestion.reasons, warnings: notesInfo }, null, 2));
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
  return 0;
}
