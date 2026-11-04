// harness install: wires the harness into a consumer repo. Additive and idempotent: it never overwrites
// files that already exist (except with --force for the CI workflow), and it never installs packages.
//
//   1. .harness/ sources from the templates (policies, notebook templates, skills, agents, hook, doctor.yml)
//   2. .gitignore entries for local state
//   3. a package.json script
//   4. the pre-commit hook through the hook manager the repo already uses (Husky or lefthook)
//   5. .github/workflows/harness.yml running only `harness check`
//   6. harness sync (AGENTS.md, CLAUDE.md, .claude/)
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { ARCHITECTURE_FILE, CliError } from '../context.js';
import { readText } from '../project.js';
import { templatesDir, readTemplate } from '../templates.js';
import { sync as runSync } from '../sync/index.js';

export const options = {
  'dry-run': { type: 'boolean' },
  force: { type: 'boolean' },
  'skip-hook': { type: 'boolean' },
  'skip-ci': { type: 'boolean' },
};

export const help = `Usage: harness install [--dry-run] [--force] [--skip-hook] [--skip-ci]

Wires the harness into this repo, additively (existing files are never overwritten):
  - .harness/ sources (policies, templates, skills, agents, pre-commit script, doctor.yml)
  - .gitignore entries for .harness/backlog/, .harness/progress/ and .harness/init-report.md
  - a "harness:check" script in package.json
  - the pre-commit hook in Husky (.husky/pre-commit) or lefthook (lefthook.yml), whichever the repo uses
  - .github/workflows/harness.yml running only \`harness check\` (--force overwrites it)
  - harness sync (AGENTS.md, CLAUDE.md, .claude/)
It never installs packages. Run \`harness init\` afterwards if there is no architecture.yml yet.`;

export const HOOK_LINE = 'sh .harness/hooks/pre-commit.sh';
export const GITIGNORE_LINES = ['.harness/backlog/', '.harness/progress/', '.harness/init-report.md'];
export const WORKFLOW_FILE = '.github/workflows/harness.yml';
export const SCRIPT = { name: 'harness:check', command: 'harness check' };
const deps = (pkg) => ({ ...pkg.dependencies, ...pkg.devDependencies });
const LEFTHOOK_FILES = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml'];

/** Every template file under templates/.harness, as repo-relative paths. */
function harnessSources() {
  const base = templatesDir();
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(base, rel)).sort()) {
      const r = `${rel}/${name}`;
      if (statSync(path.join(base, r)).isDirectory()) walk(r);
      else out.push(r);
    }
  };
  walk('.harness');
  return out;
}

function packageManager(root) {
  if (existsSync(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(path.join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(path.join(root, 'bun.lockb')) || existsSync(path.join(root, 'bun.lock'))) return 'bun';
  return 'npm';
}

/** CI steps to set up the package manager and install dependencies. */
export function ciSteps(root, pkg) {
  const pm = packageManager(root);
  const node = '      - uses: actions/setup-node@v4\n        with:\n          node-version: 22';
  if (pm === 'pnpm') {
    let version = /^pnpm@(\d+)/.exec(pkg.packageManager ?? '')?.[1];
    if (!version) {
      try {
        version = execFileSync('pnpm', ['--version'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('.')[0];
      } catch {
        version = '10';
      }
    }
    const setup = pkg.packageManager?.startsWith('pnpm@') ? '      - uses: pnpm/action-setup@v4' : `      - uses: pnpm/action-setup@v4\n        with:\n          version: ${version}`;
    return { setup: `${setup}\n${node}\n          cache: pnpm`, install: 'pnpm install --frozen-lockfile' };
  }
  if (pm === 'yarn') return { setup: `${node}\n          cache: yarn`, install: 'yarn install --frozen-lockfile' };
  if (pm === 'bun') return { setup: `      - uses: oven-sh/setup-bun@v2\n${node}`, install: 'bun install --frozen-lockfile' };
  return { setup: `${node}\n          cache: npm`, install: 'npm ci' };
}

function defaultBranch(root) {
  try {
    const ref = execFileSync('git', ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return ref.replace(/^origin\//, '') || 'main';
  } catch {
    try {
      execFileSync('git', ['rev-parse', '--verify', '--quiet', 'refs/heads/main'], { cwd: root, stdio: 'ignore' });
      return 'main';
    } catch {
      return existsSync(path.join(root, '.git', 'refs', 'heads', 'master')) ? 'master' : 'main';
    }
  }
}

/**
 * Plans and (unless dryRun) applies the installation.
 * @param {string} root
 * @param {{ dryRun?: boolean, force?: boolean, skipHook?: boolean, skipCi?: boolean }} opts
 * @returns {{ actions: string[], notes: string[] }}
 */
export function installInto(root, opts = {}) {
  const actions = [];
  const notes = [];
  const dry = Boolean(opts.dryRun);
  const write = (rel, content, mode) => {
    if (dry) return;
    mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    writeFileSync(path.join(root, rel), content);
    if (mode) chmodSync(path.join(root, rel), mode);
  };
  const pkgText = readText(root, 'package.json');
  if (pkgText === null) throw new CliError('No package.json here. Run harness install at the root of a JavaScript project.');
  let pkg;
  try {
    pkg = JSON.parse(pkgText);
  } catch (e) {
    throw new CliError(`package.json is not valid JSON: ${e.message}`);
  }

  // 1. sources
  let copied = 0;
  let kept = 0;
  for (const rel of harnessSources()) {
    if (existsSync(path.join(root, rel))) {
      kept++;
      continue;
    }
    write(rel, readTemplate(rel), rel.endsWith('.sh') ? 0o755 : undefined);
    copied++;
  }
  actions.push(`.harness/ sources: ${copied} file(s) added${kept ? `, ${kept} already there (kept)` : ''}`);

  // 2. .gitignore
  const gi = readText(root, '.gitignore') ?? '';
  const have = new Set(gi.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !have.has(l) && !have.has(`/${l}`));
  if (missing.length) {
    write('.gitignore', `${gi}${gi && !gi.endsWith('\n') ? '\n' : ''}${gi ? '\n' : ''}# harness: local state (not shared)\n${missing.join('\n')}\n`);
    actions.push(`.gitignore: added ${missing.join(', ')}`);
  } else actions.push('.gitignore: already ignores the local harness folders');

  // 3. package.json script
  if (pkg.scripts?.[SCRIPT.name]) actions.push(`package.json: script "${SCRIPT.name}" already exists (kept)`);
  else {
    const indent = /^(\s+)"/m.exec(pkgText)?.[1] ?? '  ';
    pkg.scripts = { ...(pkg.scripts ?? {}), [SCRIPT.name]: SCRIPT.command };
    write('package.json', `${JSON.stringify(pkg, null, indent)}\n`);
    actions.push(`package.json: added script "${SCRIPT.name}": "${SCRIPT.command}"`);
  }

  // 4. pre-commit hook
  if (opts.skipHook) actions.push('pre-commit hook: skipped (--skip-hook)');
  else {
    const declared = deps(pkg);
    const lefthook = LEFTHOOK_FILES.find((f) => existsSync(path.join(root, f)));
    if (lefthook || declared.lefthook) {
      const file = lefthook ?? 'lefthook.yml';
      const doc = parseDocument(readText(root, file) ?? '');
      if (doc.errors.length) notes.push(`${file} is not valid YAML; add the hook by hand: pre-commit → commands → harness → run: ${HOOK_LINE}`);
      else if (doc.getIn(['pre-commit', 'commands', 'harness', 'run'])) actions.push(`pre-commit hook: ${file} already runs harness`);
      else {
        if (!doc.contents) doc.contents = doc.createNode({});
        doc.setIn(['pre-commit', 'commands', 'harness', 'run'], HOOK_LINE);
        write(file, String(doc));
        actions.push(`pre-commit hook: added "harness" to ${file} (lefthook)`);
      }
    } else if (existsSync(path.join(root, '.husky')) || declared.husky) {
      const file = '.husky/pre-commit';
      const current = readText(root, file);
      if (current?.includes(HOOK_LINE)) actions.push(`pre-commit hook: ${file} already runs harness`);
      else {
        write(file, current === null ? `${HOOK_LINE}\n` : `${current}${current.endsWith('\n') ? '' : '\n'}${HOOK_LINE}\n`, 0o755);
        actions.push(`pre-commit hook: ${current === null ? 'created' : 'appended to'} ${file} (Husky)`);
        if (!declared.husky) notes.push('.husky/ exists but husky is not in package.json: hooks only run once Husky is installed (`npx husky init`).');
      }
    } else {
      notes.push(
        `No Husky or lefthook found, so no git hook was added (harness doesn't install packages). Install one, e.g. \`npx husky init\`, then re-run \`harness install\`; or call \`${HOOK_LINE}\` from your own pre-commit hook. CI still enforces the check.`,
      );
    }
  }

  // 5. CI workflow
  if (opts.skipCi) actions.push('CI workflow: skipped (--skip-ci)');
  else if (existsSync(path.join(root, WORKFLOW_FILE)) && !opts.force) actions.push(`CI workflow: ${WORKFLOW_FILE} already exists (kept; --force to overwrite)`);
  else {
    const steps = ciSteps(root, pkg);
    const yml = readTemplate(WORKFLOW_FILE).replace('{{branch}}', defaultBranch(root)).replace('{{setup}}', steps.setup).replace('{{install}}', steps.install);
    write(WORKFLOW_FILE, yml);
    actions.push(`CI workflow: wrote ${WORKFLOW_FILE} (${packageManager(root)})`);
  }

  // 6. sync
  if (dry) actions.push('harness sync: would generate AGENTS.md (if missing), CLAUDE.md (if missing) and .claude/');
  else {
    const r = runSync(root);
    actions.push(`harness sync: ${r.changes.length ? r.changes.length + ' change(s)' : 'nothing to do'}`);
    notes.push(...r.warnings);
  }

  if (!existsSync(path.join(root, ARCHITECTURE_FILE))) notes.push(`No ${ARCHITECTURE_FILE} yet: run \`npx harness init\` to draft the architecture plan and the baseline.`);
  if (!deps(pkg)['@harness/cli']) notes.push('@harness/cli is not in package.json: install it as a dev dependency so the hook and CI can run it.');
  notes.push('In GitHub, protect the main branch: require a PR with an approval and the "harness" check to pass. That is the real guarantee.');
  return { actions, notes };
}


/** @param {{ root: string, values: Record<string, any>, out: (s: string) => void }} ctx */
export async function install(ctx) {
  const { root, values, out } = ctx;
  const r = installInto(root, { dryRun: values['dry-run'], force: values.force, skipHook: values['skip-hook'], skipCi: values['skip-ci'] });
  out(values['dry-run'] ? 'harness install (dry run, nothing written):' : 'harness install:');
  for (const a of r.actions) out(`  - ${a}`);
  if (r.notes.length) {
    out('\nNext:');
    for (const n of r.notes) out(`  - ${n}`);
  }
  return 0;
}
