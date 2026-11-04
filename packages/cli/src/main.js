import { realpathSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { CliError, findRepoRoot } from './context.js';
import { pkg, SCOPE } from './scope.js';
import * as checkCmd from './commands/check.js';
import * as initCmd from './commands/init.js';

export { SCOPE };

/** Implemented commands. */
const COMMANDS = {
  check: { run: checkCmd.check, options: checkCmd.options, help: checkCmd.help },
  init: { run: initCmd.init, options: initCmd.options, help: initCmd.help },
};

/** Commands planned in docs/DESIGN.md, wired in later phases. */
export const PLANNED_COMMANDS = ['doctor', 'notes', 'scope', 'sync', 'audit', 'progress', 'review', 'install'];

const HELP = `Usage: harness <command> [options]

Commands:
  check    Check the architecture rules (git hook and CI)
  init     Draft .harness/architecture.yml and baseline.json from the code

Not implemented yet: ${PLANNED_COMMANDS.join(', ')}

Options:
  -h, --help     Show help (also: harness <command> --help)
  -v, --version  Show the version`;

/** Asks a yes/no question on the terminal; undefined when there is no terminal (CI, hooks, agents). */
async function terminalConfirm(question) {
  const { createInterface } = await import('node:readline/promises');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim());
  } finally {
    rl.close();
  }
}

/**
 * Runs the CLI.
 * @param {string[]} argv arguments without node and script path
 * @param {{ out?: (s: string) => void, err?: (s: string) => void, cwd?: string, env?: NodeJS.ProcessEnv,
 *   adapterSearchPaths?: string[], confirm?: (q: string) => Promise<boolean>, today?: string }} [io]
 *   Everything in io is injectable for tests.
 * @returns {Promise<number>} exit code
 */
export async function run(argv, io = {}) {
  const out = io.out ?? ((s) => process.stdout.write(s + '\n'));
  const err = io.err ?? ((s) => process.stderr.write(s + '\n'));
  const [command, ...rest] = argv;

  if (!command || command === '-h' || command === '--help') {
    out(HELP);
    return 0;
  }
  if (command === '-v' || command === '--version') {
    out(pkg.version);
    return 0;
  }
  if (PLANNED_COMMANDS.includes(command)) {
    err(`harness ${command}: not implemented yet.`);
    return 2;
  }
  const cmd = COMMANDS[command];
  if (!cmd) {
    err(`Unknown command: ${command}\n\n${HELP}`);
    return 2;
  }

  let values;
  try {
    ({ values } = parseArgs({ args: rest, strict: true, allowPositionals: false, options: { ...cmd.options, help: { type: 'boolean', short: 'h' } } }));
  } catch (e) {
    err(`${e.message}\n\n${cmd.help}`);
    return 2;
  }
  if (values.help) {
    out(cmd.help);
    return 0;
  }

  // Real paths: git returns the resolved root, so a symlinked cwd (e.g. macOS /var -> /private/var)
  // would otherwise turn `--files` into wrong repo-relative paths.
  const cwd = realpathSync(io.cwd ?? process.cwd());
  const confirm = io.confirm ?? (process.stdin.isTTY && process.stdout.isTTY ? terminalConfirm : undefined);
  try {
    return await cmd.run({ root: realpathSync(findRepoRoot(cwd)), cwd, values, out, err, env: io.env ?? process.env, adapterSearchPaths: io.adapterSearchPaths, confirm, today: io.today });
  } catch (e) {
    if (e instanceof CliError) {
      err(e.message);
      return e.exitCode;
    }
    throw e;
  }
}
