import { sync as runSync, MANIFEST_FILE } from '../sync/index.js';
import { CliError } from '../context.js';

export const options = {
  check: { type: 'boolean' },
  claude: { type: 'boolean' },
  'skip-claude': { type: 'boolean' },
};

export const help = `Usage: reins sync [--check] [--claude | --skip-claude]

Syncs provider-neutral .reins/core/ sources and managed rules/notes blocks in AGENTS.md.
Generates the optional Claude Code adapter (.claude/ and CLAUDE.md) by default; its preference is saved.
Only touches what it generated (listed in ${MANIFEST_FILE}); never other skills, agents or settings.

Options:
  --check         Write nothing; exit 1 if the generated files differ from their sources (CI, reins check)
  --skip-claude   Disable Claude Code files and save that preference
  --claude        Enable Claude Code files and save that preference`;

/** @param {{ root: string, values: Record<string, any>, out: (s: string) => void }} ctx */
export async function sync(ctx) {
  const { root, values, out } = ctx;
  if (values.claude && values['skip-claude']) throw new CliError('Use either --claude or --skip-claude, not both.');
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
  return 0;
}
