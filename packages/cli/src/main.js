import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

/** npm scope of the harness packages, derived from this package's own name. */
export const SCOPE = pkg.name.split('/')[0];

/** Commands planned in docs/DESIGN.md. They are wired in later phases. */
export const PLANNED_COMMANDS = ['init', 'check', 'doctor', 'notes', 'scope', 'sync', 'audit', 'progress', 'review', 'install'];

const HELP = `Usage: harness <command> [options]

Commands (not implemented yet):
  ${PLANNED_COMMANDS.join(', ')}

Options:
  -h, --help     Show this help
  -v, --version  Show the version`;

/**
 * Runs the CLI.
 * @param {string[]} argv arguments without node and script path
 * @param {{ out?: (s: string) => void, err?: (s: string) => void }} [io]
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s + '\n'));
  const err = io.err ?? ((s) => process.stderr.write(s + '\n'));

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      strict: false,
      options: { help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'v' } },
    });
  } catch (e) {
    err(String(e.message));
    return 2;
  }
  const [command] = parsed.positionals;

  if (parsed.values.version) {
    out(pkg.version);
    return 0;
  }
  if (parsed.values.help || !command) {
    out(HELP);
    return 0;
  }
  if (PLANNED_COMMANDS.includes(command)) {
    err(`harness ${command}: not implemented yet.`);
    return 2;
  }
  err(`Unknown command: ${command}\n\n${HELP}`);
  return 2;
}
