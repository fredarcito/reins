// reins impact <file-or-folder>: the reverse of scope. Before changing a shared file: which domains
// consume it, which imports bypass a public API, which violations already involve it, and the minimum
// task level if the change breaks its importers (same thresholds as `reins scope`).
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { emptyBaseline, impactOf, notesFor, runCheck, scopeSignals, suggestLevel } from '@agentreins/core';
import { ARCHITECTURE_FILE, CliError, toRepoPath } from '../context.js';
import { loadNotes, readDoctorConfig } from '../project.js';
import { analyze, readBaseline } from './check.js';

export const options = { json: { type: 'boolean' } };
export const positionals = true;

export const help = `Usage: reins impact <file-or-folder> [--json]

What a change to one file (or everything under a folder) would reach, from the import graph:
the domains that consume it, which imports bypass a domain's public_api, which violations already
involve it, the notes to read first, and the minimum task level if the change breaks its importers
(same thresholds as \`reins scope\`).

Fine-grained questions (who calls one symbol inside a domain) stay with grep: run it inside the
domains listed here.`;

/** "no domain" group of consumers, for the text output. */
const group = (g) => `${g.domain ?? 'no domain'} (${g.files.length})`;

/**
 * @param {{ root: string, cwd: string, values: Record<string, any>, positionals: string[], out: (s: string) => void,
 *   adapterSearchPaths?: string[] }} ctx
 * @returns {Promise<number>}
 */
export async function impact(ctx) {
  const { root, cwd, values, out } = ctx;
  if (ctx.positionals.length !== 1) {
    out(help);
    return 2;
  }
  const file = toRepoPath(root, cwd, ctx.positionals[0]).replace(/\/$/, '');
  const abs = path.join(root, file);
  if (!existsSync(abs)) throw new CliError(`"${file}" does not exist in the repo.`);
  const isFolder = statSync(abs).isDirectory();

  const { config, graph, extra } = await analyze(root, { searchPaths: ctx.adapterSearchPaths });
  const result = impactOf(file, graph.edges, config.domains, graph.uses);
  const warnings = [...graph.warnings];

  // The files a breaking change would touch: the target plus everyone who imports it.
  const files = result.targets.length ? [...new Set([...result.targets, ...result.consumers.map((c) => c.file)])] : [file];
  const thresholds = readDoctorConfig(root).triage;
  const signals = scopeSignals(files, config.domains, ARCHITECTURE_FILE);
  const suggestion = suggestLevel(signals, thresholds);
  const { notes: all } = loadNotes(root);
  const notes = [...new Set(files.flatMap((f) => notesFor(f, all).map((n) => n.file)))];

  // Violations whose from or to is the target (so its importers' imports of it count): the `check --files` filter.
  let baseline = emptyBaseline();
  try {
    baseline = readBaseline(root).baseline;
  } catch (e) {
    warnings.push(e.message);
  }
  const violations = runCheck({ edges: graph.edges, config, baseline, extra, files: [file, ...result.targets] }).violations;

  if (values.json) {
    out(JSON.stringify({
      file,
      folder: isFolder,
      owner: result.owner,
      targets: result.targets,
      consumers: result.consumers,
      domains: result.domains,
      publicApi: result.publicApi,
      crossings: result.crossings,
      violations: violations.map(({ rule, severity, status, from, to, message }) => ({ rule, severity, status, from, to, message })),
      notes,
      level: suggestion.level,
      reasons: suggestion.reasons,
      warnings,
    }, null, 2));
    return 0;
  }

  for (const w of warnings) out(`! warning  ${w}`);
  // `check --files` matches paths exactly: a folder must be spelled out as its files.
  const checkArgs = !isFolder ? file : result.targets.length <= 3 ? result.targets.join(',') : null;
  const importedBy = result.consumers.length
    ? `${result.consumers.length} file${result.consumers.length === 1 ? '' : 's'} — ${result.domains.map(group).join(', ')}`
    : 'nobody (no importers in the graph)';
  const crossings = result.crossings.length
    ? `${result.crossings.length} — ${result.crossings.map((x) => `${x.from} imports ${x.to} (bypasses ${x.domain}'s public API)`).join('; ')}`
    : 'none';
  const existing = violations.length
    ? `${violations.length} (${[...violations.reduce((m, v) => m.set(`${v.rule} ${v.status}`, (m.get(`${v.rule} ${v.status}`) ?? 0) + 1), new Map())]
        .map(([k, n]) => `${k}${n > 1 ? ` ×${n}` : ''}`)
        .join(', ')}; run \`reins check${checkArgs ? ` --files ${checkArgs}` : ''}\` to see them)`
    : 'none';
  out(
    [
      `${isFolder ? 'Folder' : 'File'}: ${file}${result.owner ? ` (domain: ${result.owner})` : ' (no domain)'}`,
      `Imported by: ${importedBy}`,
      `Public API: ${result.publicApi.length ? `yes (${result.publicApi.join(', ')})` : 'no'}`,
      `Boundary crossings: ${crossings}`,
      `Existing violations: ${existing}`,
      `Notes to read: ${notes.join(', ') || 'none'}`,
      `Minimum level (if the change breaks importers): ${suggestion.level} (${suggestion.reasons.join('; ')})`,
    ].join('\n'),
  );
  return 0;
}
