import { sync as runSync, MANIFEST_FILE } from '../sync/index.js';

export const options = { check: { type: 'boolean' } };

export const help = `Usage: harness sync [--check]

Generates the agent tool files from .harness/: .claude/skills/harness-*, .claude/agents/harness-*, the notes index
inside AGENTS.md, and the notes hook + git permissions in .claude/settings.json. Creates AGENTS.md and CLAUDE.md
when missing. Only touches what it generated (listed in ${MANIFEST_FILE}); never other skills, agents or settings.

Options:
  --check   Write nothing; exit 1 if the generated files differ from their sources (CI, harness check)`;

/** @param {{ root: string, values: Record<string, any>, out: (s: string) => void }} ctx */
export async function sync(ctx) {
  const { root, values, out } = ctx;
  const r = runSync(root, { check: values.check });
  for (const w of r.warnings) out(`! warning  ${w}`);
  if (values.check) {
    if (!r.divergences.length) {
      out('harness sync --check: generated files are up to date.');
      return 0;
    }
    out(`harness sync --check: ${r.divergences.length} difference(s):`);
    for (const d of r.divergences) out(`  - ${d}`);
    out('Fix: run `harness sync` and commit the result. Edit the sources in .harness/, not the generated files.');
    return 1;
  }
  if (!r.changes.length) out('harness sync: nothing to do.');
  else {
    out(`harness sync: ${r.changes.length} change(s):`);
    for (const c of r.changes) out(`  - ${c}`);
  }
  return 0;
}
