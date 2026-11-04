// Location of the templates/ folder: shipped inside the package (copied at pack time by prepack),
// or the monorepo's root templates/ during development.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const CANDIDATES = [new URL('../templates/', import.meta.url), new URL('../../../templates/', import.meta.url)];

/** Absolute path of the templates folder. */
export function templatesDir() {
  for (const url of CANDIDATES) {
    const dir = fileURLToPath(url);
    if (existsSync(path.join(dir, 'AGENTS.md'))) return dir;
  }
  throw new Error('harness: templates folder not found (broken install?).');
}

/** Text of one template, e.g. "AGENTS.md" or ".harness/policies/triage.md". */
export const readTemplate = (rel) => readFileSync(path.join(templatesDir(), rel), 'utf8');

/**
 * AGENTS.md for a repo: project name and commands from its package.json.
 * @param {string} root
 * @param {(cmd: string) => string} run how to run a package script (e.g. s => `npm run ${s}`)
 */
export function renderAgentsMd(root, run) {
  let pkg = {};
  try {
    pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    /* no package.json: defaults */
  }
  const scripts = Object.keys(pkg.scripts ?? {});
  const commands = ['dev', 'build', 'test', 'lint'].filter((s) => scripts.includes(s)).map((s) => `\`${run(s)}\``);
  return readTemplate('AGENTS.md')
    .replace('{{project}}', pkg.name ?? path.basename(root))
    .replace('{{commands}}', commands.join(' · ') || '`<add your dev and test commands>`');
}
