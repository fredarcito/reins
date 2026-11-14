import { existsSync } from 'node:fs';
import path from 'node:path';
import { sync as runSync, MANIFEST_FILE } from '../sync/index.js';
import { CliError } from '../context.js';
import { suggestBase, suggestBaseHint } from '../base.js';

export const options = {
  check: { type: 'boolean' },
  local: { type: 'boolean' },
  claude: { type: 'boolean' },
  'skip-claude': { type: 'boolean' },
};

export const help = `Usage: reins sync [--check | --local] [--claude | --skip-claude]

Syncs provider-neutral .reins/core/ sources and managed rules/notes blocks in AGENTS.md.
Generates the optional Claude Code adapter (.claude/ and CLAUDE.md) by default; its preference is saved.
Only touches what it generated (listed in ${MANIFEST_FILE}); never other skills, agents or settings.

Options:
  --check         Write nothing; exit 1 if the generated files differ from their sources (CI, reins check).
                  Generated files the repo gitignores (say .claude/) are not compared: each machine makes its own
  --local         Write only the generated files the repo gitignores, never a committed file; silent when nothing
                  changes and never fails (package.json's "prepare", or "postinstall" with yarn, runs it on install)
  --skip-claude   Disable Claude Code files and save that preference
  --claude        Enable Claude Code files and save that preference`;

/** @param {{ root: string, values: Record<string, any>, out: (s: string) => void }} ctx */
export async function sync(ctx) {
  const { root, values, out } = ctx;
  if (values.claude && values['skip-claude']) throw new CliError('Use either --claude or --skip-claude, not both.');
  if (values.local && (values.check || values.claude || values['skip-claude'])) throw new CliError('--local goes alone: it follows the Claude Code choice saved by the last `reins sync`.');
  if (values.local) return syncLocal(ctx);
  const r = runSync(root, { check: values.check, claude: values.claude, skipClaude: values['skip-claude'] });
  for (const w of r.warnings) out(`! warning  ${w}`);
  if (values.check) {
    if (!r.divergences.length) {
      out('reins sync --check: generated files are up to date.');
      return 0;
    }
    out(`reins sync --check: ${r.divergences.length} difference(s):`);
    for (const d of r.divergences) out(`  - ${d}`);
    out('Fix: run `reins sync` and commit the result. Edit the sources in .reins/, not the generated files.');
    return 1;
  }
  if (!r.changes.length) out('reins sync: nothing to do.');
  else {
    out(`reins sync: ${r.changes.length} change(s):`);
    for (const c of r.changes) out(`  - ${c}`);
  }
  const base = suggestBase(root); // reins update runs sync: existing repos hear about base: once they upgrade
  if (base) out(suggestBaseHint(base));
  return 0;
}

/**
 * `sync --local`, run by package.json's install script ("prepare", or "postinstall" with yarn): the gitignored generated files (say .claude/) for
 * this machine. Never fails an install: any problem is one line on stderr and exit 0. Does nothing until the repo
 * has adopted sync (no manifest), so a stray prepare script never creates files a repo didn't ask for.
 * @param {{ root: string, out: (s: string) => void, err: (s: string) => void }} ctx
 */
function syncLocal({ root, out, err }) {
  try {
    if (!existsSync(path.join(root, MANIFEST_FILE))) return 0;
    const r = runSync(root, { local: true });
    if (r.changes.length) out(`reins sync --local: ${r.changes.length} gitignored generated file(s) written for this machine.`);
  } catch (e) {
    err(`reins sync --local: skipped (${e instanceof Error ? e.message : e}).`);
  }
  return 0;
}
