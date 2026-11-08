// reins update: updates @agentreins/cli and installed @agentreins/adapter-* packages
// using the repo's package manager, then runs reins sync.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { CliError } from '../context.js';
import { readText } from '../project.js';
import { pkg as cliPkg, SCOPE } from '../scope.js';

export const options = {
  'dry-run': { type: 'boolean' },
  claude: { type: 'boolean' },
  'skip-claude': { type: 'boolean' },
};

export const help = `Usage: reins update [--dry-run] [--claude | --skip-claude]

Updates @agentreins/cli (and adapter if installed) to latest with this repo's package manager,
then syncs the provider-neutral core and AGENTS.md. Claude Code adapter preference is retained; use --claude or --skip-claude to change it.`;

function packageManager(root) {
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(root, 'bun.lockb')) || existsSync(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

function updateCommand(pm, packages, root) {
  // at a pnpm workspace root, `pnpm add` refuses to run without -w
  if (pm === 'pnpm') return ['pnpm', ['add', '-D', ...(existsSync(path.join(root, 'pnpm-workspace.yaml')) ? ['-w'] : []), ...packages.map((p) => `${p}@latest`)]];
  if (pm === 'yarn') return ['yarn', ['add', '-D', ...packages.map((p) => `${p}@latest`)]];
  if (pm === 'bun') return ['bun', ['add', '-d', ...packages.map((p) => `${p}@latest`)]];
  return ['npm', ['install', '-D', ...packages.map((p) => `${p}@latest`)]];
}

function syncCommand(pm, options) {
  const args = ['reins', 'sync', ...(options.claude ? ['--claude'] : options.skipClaude ? ['--skip-claude'] : [])];
  if (pm === 'pnpm') return ['pnpm', ['exec', ...args]];
  if (pm === 'yarn') return ['yarn', ['run', ...args]];
  if (pm === 'bun') return ['bun', ['run', ...args]];
  return ['npm', ['exec', '--', ...args]];
}

/** Version of `name` installed at the repo root, or null. */
function installedVersion(root, name) {
  try {
    return JSON.parse(readText(root, `node_modules/${name}/package.json`) ?? 'null')?.version ?? null;
  } catch {
    return null;
  }
}

/**
 * What to tell after the package manager ran. Package managers may hold `@latest` back on purpose
 * (pnpm 11's `minimumReleaseAge` waits a day by default), and they exit 0 when they do: say so instead of staying silent.
 * @param {string} name
 * @param {string | null} before
 * @param {string | null} after
 * @param {string} pm
 * @returns {string | null}
 */
export function versionReport(name, before, after, pm) {
  if (!after) return null;
  if (before && before !== after) return `reins update: ${name} ${before} -> ${after}`;
  const hint = pm === 'pnpm' ? ' (pnpm waits before installing new releases: `minimumReleaseAge`, a day by default)' : '';
  return `reins update: ${name} is still ${after}. Either it is the latest, or ${pm} held a newer release back${hint}. Run \`reins update\` again later, or install an exact version with ${pm}.`;
}

/** @param {{ root: string, values: Record<string, any>, out: (s: string) => void }} ctx */
export async function update(ctx) {
  const { root, values, out } = ctx;
  if (values.claude && values['skip-claude']) throw new CliError('Use either --claude or --skip-claude, not both.');
  const pkgText = readText(root, 'package.json');
  if (pkgText === null) throw new CliError('No package.json here. Run reins update at the root of a JavaScript project.');
  let pkg;
  try {
    pkg = JSON.parse(pkgText);
  } catch (e) {
    throw new CliError(`package.json is not valid JSON: ${e.message}`);
  }

  const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
  const packagesToUpdate = [cliPkg.name];

  // Upgrade every installed language adapter, not only adapter-js.
  const adapterPrefix = `${SCOPE}/adapter-`;
  for (const dep of Object.keys(allDeps)) {
    if (dep.startsWith(adapterPrefix)) {
      packagesToUpdate.push(dep);
    }
  }

  const pm = packageManager(root);
  const [cmd, args] = updateCommand(pm, packagesToUpdate, root);

  out(`reins update: updating ${packagesToUpdate.join(', ')} with ${pm}...`);
  if (!values['dry-run']) {
    const before = installedVersion(root, cliPkg.name);
    try {
      execFileSync(cmd, args, { cwd: root, stdio: 'inherit' });
    } catch (e) {
      throw new CliError(`Failed to update dependencies: ${e.message}`);
    }
    const report = versionReport(cliPkg.name, before, installedVersion(root, cliPkg.name), pm);
    if (report) out(`\n${report}`);
  } else {
    out(`  (dry run: would run ${cmd} ${args.join(' ')})`);
  }

  out('\nreins update: running reins sync...');
  if (!values['dry-run']) {
    const [syncCmd, syncArgs] = syncCommand(pm, { claude: values.claude, skipClaude: values['skip-claude'] });
    try {
      execFileSync(syncCmd, syncArgs, { cwd: root, stdio: 'inherit' });
    } catch (e) {
      throw new CliError(`Failed to run reins sync after updating dependencies: ${e.message}`);
    }
  } else {
    const [syncCmd, syncArgs] = syncCommand(pm, { claude: values.claude, skipClaude: values['skip-claude'] });
    out(`  (dry run: would run ${syncCmd} ${syncArgs.join(' ')})`);
  }

  return 0;
}
