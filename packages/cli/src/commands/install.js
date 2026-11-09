// reins install: wires reins into a consumer repo. Additive and idempotent: it never overwrites
// files that already exist (except with --force for the CI workflow), and it never installs packages.
//
//   1. .reins/ starter sources (hook, doctor.yml); reins sync manages the shared core
//   2. .gitignore entries for local state
//   3. a package.json script
//   4. the pre-commit hook through the hook manager the repo already uses (Husky or lefthook)
//   5. .github/workflows/reins.yml running only `reins check`
//   6. the notes index block at the end of an existing AGENTS.md that has none
//   7. reins sync (shared core and AGENTS.md; optional Claude Code adapter)
import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseDocument } from 'yaml';
import { ARCHITECTURE_FILE, CliError } from '../context.js';
import { readText } from '../project.js';
import { templatesDir, readTemplate } from '../templates.js';
import { pkg as cliPkg } from '../scope.js';
import { migrateLegacyRules, NOTES_BLOCK_RE, NOTES_BLOCK_SECTION, RULES_BLOCK_RE, RULES_BLOCK_SECTION, sync as runSync } from '../sync/index.js';

export const options = {
  'dry-run': { type: 'boolean' },
  force: { type: 'boolean' },
  'skip-hook': { type: 'boolean' },
  'skip-ci': { type: 'boolean' },
  claude: { type: 'boolean' },
  'skip-claude': { type: 'boolean' },
};

export const help = `Usage: reins install [--dry-run] [--force] [--skip-hook] [--skip-ci] [--claude | --skip-claude]

Wires reins into this repo without overwriting user-owned files:
  - .reins/ starter sources (pre-commit script, doctor.yml)
  - .gitignore entries for .reins/backlog/, .reins/progress/ and .reins/init-report.md
  - a "reins:check" script in package.json
  - the pre-commit hook in Husky (.husky/pre-commit) or lefthook (lefthook.yml), whichever the repo uses
  - .github/workflows/reins.yml running only \`reins check\` (--force overwrites it)
  - the reins rules and module notes blocks at the end of an existing AGENTS.md that has none
  - reins sync (.reins/core/, AGENTS.md; Claude Code files by default, disabled with --skip-claude and re-enabled with --claude)
It never installs packages. Run \`reins init\` afterwards if there is no architecture.yml yet.`;

export const HOOK_LINE = 'sh .reins/hooks/pre-commit.sh';
export const GITIGNORE_LINES = ['.reins/backlog/', '.reins/progress/', '.reins/tmp/', '.reins/init-report.md']; // tmp: the PR map's base worktree
export const WORKFLOW_FILE = '.github/workflows/reins.yml';
export const SCRIPT = { name: 'reins:check', command: 'reins check' };
const deps = (pkg) => ({ ...pkg.dependencies, ...pkg.devDependencies });
const LEFTHOOK_FILES = ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml', '.lefthook.yaml'];

/** Starter template files under templates/.reins (core/ is managed by reins sync). */
function reinsSources() {
  const base = templatesDir();
  const out = [];
  const walk = (rel) => {
    for (const name of readdirSync(path.join(base, rel)).sort()) {
      // core/ and the READMEs of the override folders are managed by reins sync
      if (rel === '.reins' && ['core', 'skills', 'agents', 'policies', 'templates', 'review'].includes(name)) continue;
      const r = `${rel}/${name}`;
      if (statSync(path.join(base, r)).isDirectory()) walk(r);
      else out.push(r);
    }
  };
  walk('.reins');
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
 * @param {{ dryRun?: boolean, force?: boolean, skipHook?: boolean, skipCi?: boolean, claude?: boolean, skipClaude?: boolean }} opts
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
  if (pkgText === null) throw new CliError('No package.json here. Run reins install at the root of a JavaScript project.');
  let pkg;
  try {
    pkg = JSON.parse(pkgText);
  } catch (e) {
    throw new CliError(`package.json is not valid JSON: ${e.message}`);
  }

  // 1. sources
  let copied = 0;
  let kept = 0;
  for (const rel of reinsSources()) {
    if (existsSync(path.join(root, rel))) {
      kept++;
      continue;
    }
    write(rel, readTemplate(rel), rel.endsWith('.sh') ? 0o755 : undefined);
    copied++;
  }
  actions.push(`.reins/ sources: ${copied} file(s) added${kept ? `, ${kept} already there (kept)` : ''}`);

  // 2. .gitignore
  const gi = readText(root, '.gitignore') ?? '';
  const have = new Set(gi.split(/\r?\n/).map((l) => l.trim()));
  const missing = GITIGNORE_LINES.filter((l) => !have.has(l) && !have.has(`/${l}`));
  if (missing.length) {
    write('.gitignore', `${gi}${gi && !gi.endsWith('\n') ? '\n' : ''}${gi ? '\n' : ''}# reins: local state (not shared)\n${missing.join('\n')}\n`);
    actions.push(`.gitignore: added ${missing.join(', ')}`);
  } else actions.push('.gitignore: already ignores the local reins folders');

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
      if (doc.errors.length) notes.push(`${file} is not valid YAML; add the hook by hand: pre-commit → commands → reins → run: ${HOOK_LINE}`);
      else if (doc.getIn(['pre-commit', 'commands', 'reins', 'run'])) actions.push(`pre-commit hook: ${file} already runs reins`);
      else {
        if (!doc.contents) doc.contents = doc.createNode({});
        doc.setIn(['pre-commit', 'commands', 'reins', 'run'], HOOK_LINE);
        write(file, String(doc));
        actions.push(`pre-commit hook: added "reins" to ${file} (lefthook)`);
      }
    } else if (existsSync(path.join(root, '.husky')) || declared.husky) {
      const file = '.husky/pre-commit';
      const current = readText(root, file);
      if (current?.includes(HOOK_LINE)) actions.push(`pre-commit hook: ${file} already runs reins`);
      else {
        write(file, current === null ? `${HOOK_LINE}\n` : `${current}${current.endsWith('\n') ? '' : '\n'}${HOOK_LINE}\n`, 0o755);
        actions.push(`pre-commit hook: ${current === null ? 'created' : 'appended to'} ${file} (Husky)`);
        if (!declared.husky) notes.push('.husky/ exists but husky is not in package.json: hooks only run once Husky is installed (`npx husky init`).');
      }
    } else {
      notes.push(
        `No Husky or lefthook found, so no git hook was added (reins doesn't install packages). Install one, e.g. \`npx husky init\`, then re-run \`reins install\`; or call \`${HOOK_LINE}\` from your own pre-commit hook. CI still enforces the check.`,
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

  // 6. an AGENTS.md the repo already had: append the rules and notes index blocks if missing (sync fills them in)
  let agents = readText(root, 'AGENTS.md');
  if (agents !== null) {
    let changed = false;
    if (migrateLegacyRules(agents) !== null) {
      actions.push('AGENTS.md: rules from an older reins found; reins sync moves them into the reins:rules block');
    } else if (!RULES_BLOCK_RE.test(agents)) {
      // before the notes block, and before its "## Module notes" heading when it has one
      const at = agents.search(/^(?:## Module notes\r?\n)?<!-- reins:notes:start/m);
      if (at >= 0) {
        agents = `${agents.slice(0, at)}${RULES_BLOCK_SECTION}\n${agents.slice(at)}`;
      } else {
        agents = `${agents}${agents.endsWith('\n') ? '' : '\n'}\n${RULES_BLOCK_SECTION}`;
      }
      changed = true;
      actions.push('AGENTS.md: appended the reins rules block (kept everything else)');
    }
    if (!NOTES_BLOCK_RE.test(agents)) {
      agents = `${agents}${agents.endsWith('\n') ? '' : '\n'}\n${NOTES_BLOCK_SECTION}`;
      changed = true;
      actions.push('AGENTS.md: appended the module notes index block (kept everything else)');
    }
    if (changed) write('AGENTS.md', agents);
  }

  // 7. sync
  if (dry) actions.push(`reins sync: would generate .reins/core/ and AGENTS.md${opts.skipClaude ? '' : ', plus Claude Code files'}`);
  else {
    const r = runSync(root, { claude: opts.claude, skipClaude: opts.skipClaude });
    actions.push(`reins sync: ${r.changes.length ? r.changes.length + ' change(s)' : 'nothing to do'}`);
    notes.push(...r.warnings);
  }

  if (!existsSync(path.join(root, ARCHITECTURE_FILE))) notes.push(`No ${ARCHITECTURE_FILE} yet: run \`npx reins init\`, then review the plan and fill in the notes with your agent (in Claude Code: /reins-arch, /reins-notes). Commit after \`reins check\` passes: the pre-commit hook needs the plan.`);
  if (!deps(pkg)[cliPkg.name]) notes.push(`${cliPkg.name} is not in package.json: install it as a dev dependency so the hook and CI can run it.`);
  notes.push('In GitHub, protect the main branch: require a PR with an approval and the "reins" check to pass. That is the real guarantee.');
  return { actions, notes };
}


/** @param {{ root: string, values: Record<string, any>, out: (s: string) => void }} ctx */
export async function install(ctx) {
  const { root, values, out } = ctx;
  if (values.claude && values['skip-claude']) throw new CliError('Use either --claude or --skip-claude, not both.');
  const r = installInto(root, { dryRun: values['dry-run'], force: values.force, skipHook: values['skip-hook'], skipCi: values['skip-ci'], claude: values.claude, skipClaude: values['skip-claude'] });
  out(values['dry-run'] ? 'reins install (dry run, nothing written):' : 'reins install:');
  for (const a of r.actions) out(`  - ${a}`);
  if (r.notes.length) {
    out('\nNext:');
    for (const n of r.notes) out(`  - ${n}`);
  }
  return 0;
}
