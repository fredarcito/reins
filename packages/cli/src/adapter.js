// Finds and loads the language adapter named in architecture.yml.
// Resolution starts at the consumer repo (not at the CLI's own folder): with pnpm, the CLI can't see packages
// it doesn't declare, and adapters are installed separately. The CLI never installs anything.
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { CONTRACT_VERSION, validateAdapter } from '@reins/core';
import { CliError, installCommand } from './context.js';
import { pkg as cliPkg, SCOPE } from './scope.js';

/** Package names tried, in order, for adapter `name`. */
export const candidates = (name) => [`${SCOPE}/adapter-${name}`, `reins-adapter-${name}`];

/** Directory of a resolved package, walking up from its entry file to the package.json with that name. */
function packageDir(entry, pkgName) {
  let dir = path.dirname(entry);
  while (dir !== path.dirname(dir)) {
    const file = path.join(dir, 'package.json');
    if (existsSync(file)) {
      try {
        if (JSON.parse(readFileSync(file, 'utf8')).name === pkgName) return dir;
      } catch {
        /* keep walking */
      }
    }
    dir = path.dirname(dir);
  }
  return null;
}

/**
 * @param {string} repoRoot
 * @param {string} name adapter name from architecture.yml, e.g. "js"
 * @param {{ searchPaths?: string[] }} [opts] extra folders to resolve from (tests, monorepo setups)
 * @returns {Promise<{ adapter: import('@reins/core/contract').Adapter, packageName: string, version: string }>}
 */
export async function resolveAdapter(repoRoot, name, opts = {}) {
  const bases = [repoRoot, ...(opts.searchPaths ?? [])];
  for (const pkgName of candidates(name)) {
    for (const base of bases) {
      const req = createRequire(path.join(base, 'package.json'));
      let entry;
      try {
        entry = req.resolve(pkgName);
      } catch {
        continue;
      }
      const dir = packageDir(entry, pkgName);
      const pkg = dir ? JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) : {};
      const declared = pkg.reins?.contract;
      if (declared !== CONTRACT_VERSION) {
        throw new CliError(
          `${pkgName}@${pkg.version ?? '?'} implements adapter contract ${declared ?? '(none declared)'}, but this version of reins needs contract ${CONTRACT_VERSION}.\n` +
            `Fix: install a matching version of ${pkgName} and ${cliPkg.name}.`,
        );
      }
      const mod = await import(pathToFileURL(entry).href);
      const adapter = mod.default ?? mod;
      const problems = validateAdapter(adapter);
      if (problems.length) throw new CliError(`${pkgName} is not a valid reins adapter:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
      return { adapter, packageName: pkgName, version: pkg.version ?? '?' };
    }
  }
  const [official] = candidates(name);
  throw new CliError(
    `Adapter "${name}" is not installed (looked for ${candidates(name).join(' and ')}).\n` +
      `Fix: ${installCommand(repoRoot, official)}`,
  );
}

/**
 * Cheap guess of which adapter a repo needs, before any adapter is installed. Only looks at marker files.
 * @returns {string | null}
 */
export function guessAdapterName(repoRoot) {
  if (existsSync(path.join(repoRoot, 'package.json'))) return 'js';
  return null;
}
