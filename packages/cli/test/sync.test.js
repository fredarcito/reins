import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cli, exampleRepo } from './helpers.js';
import { CURSOR_HOOKS, fitNotesIndex, mergeCursorHooks, mergeSettings, migrateAdapterKey, renderNotesIndex, SETTINGS } from '../src/sync/index.js';

const HOW = '- Before changing a file, run `npx reins notes <path…>` to get its module notes (the hook delivers them only on Read/Edit/Write)';
const templates = fileURLToPath(new URL('../../../templates/', import.meta.url));
const read = (dir, f) => readFileSync(path.join(dir, f), 'utf8');
const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};

/** Example repo with the .reins/ sources from templates/ (what `reins install` will copy) and one note. */
function repo({ keepAgentsMd = false } = {}) {
  const dir = exampleRepo('vite-react');
  cpSync(path.join(templates, '.reins'), path.join(dir, '.reins'), { recursive: true });
  write(dir, '.reins/notes/cart.md', '---\npaths: ["src/features/cart/**"]\n---\n- 2026-11-01: totals are integer cents.\n');
  if (keepAgentsMd) write(dir, 'AGENTS.md', '# mine\n');
  return dir;
}

const GENERATED = [
  '.reins/core/rules.md',
  '.reins/core/skills/audit/SKILL.md',
  '.reins/core/agents/reviewer.md',
  '.reins/skills/README.md', '.reins/agents/README.md', '.reins/policies/README.md', '.reins/review/README.md',
  '.claude/skills/reins-audit/SKILL.md', '.claude/skills/reins-done/SKILL.md', '.claude/skills/reins-notes/SKILL.md', '.claude/skills/reins-arch/SKILL.md', '.claude/skills/reins-agent/SKILL.md', '.claude/skills/reins-backlog/SKILL.md',
  '.claude/agents/reins-reviewer.md', '.claude/agents/reins-explorer.md',
  '.claude/settings.json', '.cursor/hooks.json', 'AGENTS.md', 'CLAUDE.md', '.reins/.generated.json',
];

test('first sync generates everything; a second sync does nothing; --check passes', async () => {
  const dir = repo();
  const first = await cli(dir, ['sync']);
  assert.equal(first.code, 0);
  for (const f of GENERATED) assert.ok(existsSync(path.join(dir, f)), f);
  const snapshot = GENERATED.map((f) => read(dir, f));

  const second = await cli(dir, ['sync']);
  assert.match(second.stdout, /nothing to do/);
  assert.deepEqual(GENERATED.map((f) => read(dir, f)), snapshot, 'idempotent');
  assert.equal((await cli(dir, ['sync', '--check'])).code, 0);
});

test('sync migrates `adapter: js` (reins <= 0.11.0) to `adapters: [js]` and touches nothing else in the plan', async () => {
  assert.equal(migrateAdapterKey('version: 1\nadapter: "js"   # the graph\nlayers: []\n'), 'version: 1\nadapters: [js]   # the graph\nlayers: []\n');
  assert.equal(migrateAdapterKey('version: 1\nadapters: [js]\n'), null);
  assert.equal(migrateAdapterKey('version: 1\nadapter:\n  - js\n'), null); // not a form sync rewrites; check explains
  const dir = repo();
  const file = path.join(dir, '.reins/architecture.yml');
  const before = read(dir, '.reins/architecture.yml');
  writeFileSync(file, before.replace(/^adapters: \[js\]$/m, 'adapter: js'));
  assert.equal((await cli(dir, ['check'])).code, 2);
  assert.equal((await cli(dir, ['sync', '--check'])).code, 1);
  const r = await cli(dir, ['sync']);
  assert.match(r.stdout, /migrated \.reins\/architecture\.yml/);
  assert.equal(read(dir, '.reins/architecture.yml'), before);
});

test('--skip-claude syncs the provider-neutral core without creating Claude files', async () => {
  const dir = repo();
  const first = await cli(dir, ['sync', '--skip-claude']);
  assert.equal(first.code, 0, first.stderr);
  assert.ok(existsSync(path.join(dir, '.reins/core/rules.md')));
  assert.match(read(dir, 'AGENTS.md'), /<!-- reins:rules:start/);
  assert.equal(existsSync(path.join(dir, '.claude')), false);
  assert.equal(existsSync(path.join(dir, 'CLAUDE.md')), false);
  assert.equal((await cli(dir, ['sync', '--check', '--skip-claude'])).code, 0);
  assert.equal((await cli(dir, ['sync', '--check'])).code, 0, 'the adapter preference persists for CI checks');
  assert.match((await cli(dir, ['sync', '--skip-claude'])).stdout, /nothing to do/);
});

test('--claude re-enables the optional adapter after a provider-neutral sync', async () => {
  const dir = repo();
  await cli(dir, ['sync', '--skip-claude']);
  const enabled = await cli(dir, ['sync', '--claude']);
  assert.equal(enabled.code, 0, enabled.stderr);
  assert.ok(existsSync(path.join(dir, 'CLAUDE.md')));
  assert.ok(existsSync(path.join(dir, '.claude/settings.json')));
  assert.equal((await cli(dir, ['sync', '--check'])).code, 0);
});

test('sync rejects conflicting Claude adapter options before writing files', async () => {
  const dir = repo();
  const result = await cli(dir, ['sync', '--claude', '--skip-claude']);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Use either --claude or --skip-claude/);
  assert.equal(existsSync(path.join(dir, '.reins/.generated.json')), false);
});

test('--skip-claude leaves an existing Claude Code adapter untouched and managed', async () => {
  const dir = repo();
  await cli(dir, ['sync']);
  write(dir, '.claude/skills/reins-audit/SKILL.md', 'manual Claude adapter change\n');
  write(dir, '.claude/settings.json', '{"manual":true}\n');
  write(dir, '.cursor/hooks.json', '{"manual":true}\n');

  const skipped = await cli(dir, ['sync', '--skip-claude']);
  assert.match(skipped.stdout, /nothing to do/);
  assert.equal(read(dir, '.claude/skills/reins-audit/SKILL.md'), 'manual Claude adapter change\n');
  assert.equal(read(dir, '.claude/settings.json'), '{"manual":true}\n');
  assert.equal(read(dir, '.cursor/hooks.json'), '{"manual":true}\n', 'the Cursor trigger belongs to the Claude Code adapter');
  assert.equal((await cli(dir, ['sync', '--check', '--skip-claude'])).code, 0);
});

test('generated content: prefixed names, Claude frontmatter, notes index, CLAUDE.md, settings', async () => {
  const dir = repo();
  await cli(dir, ['sync']);
  assert.match(read(dir, '.claude/skills/reins-audit/SKILL.md'), /^---\nname: reins-audit\ndescription: .+\n---\n<!-- Generated by reins sync from \.reins\/core\/skills\/audit\/SKILL\.md/);
  assert.match(read(dir, '.claude/agents/reins-explorer.md'), /^---\nname: reins-explorer\ndescription: .+\ntools: Read, Grep, Glob\n---\n/);
  assert.match(read(dir, 'AGENTS.md'), /^# example-vite-react\nCommands: `npm run dev` · `npm run build` · `npx reins check`/);
  assert.match(read(dir, 'AGENTS.md'), /<!-- reins:rules:start[^>]*-->\n## Always/);
  assert.match(read(dir, 'AGENTS.md'), /<!-- reins:notes:start[^>]*-->\n- Before changing a file, run `npx reins notes <path…>` .+ By path:\n- `src\/features\/cart\/\*\*` → `\.reins\/notes\/cart\.md`\n<!-- reins:notes:end -->/);
  assert.ok(read(dir, 'AGENTS.md').split('\n').length <= 31);
  assert.equal(read(dir, 'CLAUDE.md'), '@AGENTS.md\n');
  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  assert.deepEqual(settings.permissions.deny, SETTINGS.deny);
  assert.equal(settings.hooks.PreToolUse[0].matcher, 'Read|Edit|Write|MultiEdit');
  assert.match(settings.hooks.PreToolUse[0].hooks[0].command, /reins notes --hook$/);
  assert.equal(settings.hooks.SessionStart[0].matcher, 'startup|compact|clear');
  assert.match(settings.hooks.SessionStart[0].hooks[0].command, /reins resume --hook$/);
});

test('unchanged legacy skill copies do not shadow the core source or break idempotence', async () => {
  const dir = repo();
  cpSync(path.join(templates, '.reins/core/skills/audit'), path.join(dir, '.reins/skills/audit'), { recursive: true });

  const first = await cli(dir, ['sync']);
  assert.equal(first.code, 0, first.stderr);
  assert.match(read(dir, '.claude/skills/reins-audit/SKILL.md'), /Generated by reins sync from \.reins\/core\/skills\/audit\/SKILL\.md/);
  assert.match((await cli(dir, ['sync'])).stdout, /nothing to do/);
  assert.equal((await cli(dir, ['sync', '--check'])).code, 0);
});

test('never touches third-party skills, agents or settings, and keeps the order of existing settings', async () => {
  const dir = repo();
  write(dir, '.claude/skills/impeccable/SKILL.md', '---\nname: impeccable\ndescription: third party\n---\nkeep me\n');
  write(dir, '.claude/agents/mine.md', 'mine\n');
  const own = { permissions: { allow: ['Bash(npm test)'], deny: ['Read(.env)', 'Bash(git push:*)'] }, hooks: { PostToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'impeccable detect' }] }] }, model: 'x' };
  write(dir, '.claude/settings.json', JSON.stringify(own, null, 2));
  await cli(dir, ['sync']);
  assert.equal(read(dir, '.claude/skills/impeccable/SKILL.md'), '---\nname: impeccable\ndescription: third party\n---\nkeep me\n');
  assert.equal(read(dir, '.claude/agents/mine.md'), 'mine\n');
  const s = JSON.parse(read(dir, '.claude/settings.json'));
  assert.deepEqual(s.permissions.deny, ['Read(.env)', 'Bash(git push:*)', 'Bash(git commit:*)']);
  assert.deepEqual(s.permissions.allow, ['Bash(npm test)']);
  assert.deepEqual(s.hooks.PostToolUse, own.hooks.PostToolUse);
  assert.equal(s.model, 'x');
  const manifest = JSON.parse(read(dir, '.reins/.generated.json'));
  assert.deepEqual(manifest.settings.deny, ['Bash(git commit:*)'], 'a deny entry that was already there is not owned');
  assert.ok(!Object.keys(manifest.files).some((f) => f.includes('impeccable') || f.includes('mine.md')));
});

test('a file with a generated name that reins did not create is never overwritten', async () => {
  const dir = repo();
  write(dir, '.claude/skills/reins-audit/SKILL.md', 'written by a person\n');
  const r = await cli(dir, ['sync']);
  assert.match(r.stdout, /reins-audit\/SKILL\.md exists and was not generated by reins; not touched/);
  assert.equal(read(dir, '.claude/skills/reins-audit/SKILL.md'), 'written by a person\n');
  assert.equal((await cli(dir, ['sync', '--check'])).code, 1);
});

test('existing AGENTS.md and CLAUDE.md belong to the repo: only the notes block is managed', async () => {
  const dir = repo({ keepAgentsMd: true });
  write(dir, 'CLAUDE.md', 'my own CLAUDE.md\n');
  const r = await cli(dir, ['sync']);
  assert.match(r.stdout, /AGENTS\.md has no notes index markers/);
  assert.equal(read(dir, 'AGENTS.md'), '# mine\n');
  assert.equal(read(dir, 'CLAUDE.md'), 'my own CLAUDE.md\n');
  write(dir, 'AGENTS.md', '# mine\n<!-- reins:notes:start -->\nstale\n<!-- reins:notes:end -->\nafter\n');
  await cli(dir, ['sync']);
  assert.equal(read(dir, 'AGENTS.md'), '# mine\n<!-- reins:notes:start -->\n- Before changing a file, run `npx reins notes <path…>` to get its module notes (the hook delivers them only on Read/Edit/Write). By path:\n- `src/features/cart/**` → `.reins/notes/cart.md`\n<!-- reins:notes:end -->\nafter\n');
});

test('--check detects hand edits, stale sources, new notes and removed settings; sync repairs them', async () => {
  const dir = repo();
  await cli(dir, ['sync']);
  write(dir, '.claude/agents/reins-reviewer.md', 'edited\n');
  write(dir, '.reins/skills/done/SKILL.md', read(dir, '.reins/core/skills/done/SKILL.md') + '\n6. New step.\n');
  write(dir, '.reins/notes/catalog.md', '---\npaths: ["src/features/catalog/**"]\n---\n- note\n');
  const s = JSON.parse(read(dir, '.claude/settings.json'));
  s.permissions.deny = [];
  write(dir, '.claude/settings.json', JSON.stringify(s));

  const r = await cli(dir, ['sync', '--check']);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /reins-reviewer\.md: edited by hand/);
  assert.match(r.stdout, /reins-done\/SKILL\.md: out of date with \.reins\/skills\/done\/SKILL\.md/);
  assert.match(r.stdout, /AGENTS\.md: notes index out of date/);
  assert.match(r.stdout, /settings\.json: reins permissions or hook missing/);
  assert.match(read(dir, '.claude/agents/reins-reviewer.md'), /^edited/, '--check writes nothing');

  const fix = await cli(dir, ['sync']);
  assert.match(fix.stdout, /overwrote \.claude\/agents\/reins-reviewer\.md/);
  assert.equal((await cli(dir, ['sync', '--check'])).code, 0);
});

test('overwriting a file that ships with reins never points to a path inside the package', async () => {
  const dir = repo();
  await cli(dir, ['sync']);
  write(dir, '.reins/core/skills/audit/SKILL.md', 'edited\n');
  write(dir, '.reins/core/policies/triage.md', 'edited\n');
  write(dir, '.reins/skills/README.md', 'edited\n');
  write(dir, '.claude/agents/reins-reviewer.md', 'edited\n');

  const r = await cli(dir, ['sync']);
  assert.doesNotMatch(r.stdout, /templates\//);
  assert.match(r.stdout, /overwrote \.reins\/core\/skills\/audit\/SKILL\.md \(.*copy it to \.reins\/skills\/audit\/SKILL\.md/);
  assert.match(r.stdout, /overwrote \.reins\/core\/policies\/triage\.md \(it had manual changes; reins rewrites it on every sync\)/);
  assert.match(r.stdout, /overwrote \.reins\/skills\/README\.md \(it had manual changes; reins rewrites it on every sync\)/);
  assert.match(r.stdout, /overwrote \.claude\/agents\/reins-reviewer\.md \(.*copy it to \.reins\/agents\/reviewer\.md/);

  write(dir, '.reins/agents/reviewer.md', read(dir, '.reins/core/agents/reviewer.md') + '\nOurs.\n');
  await cli(dir, ['sync']);
  write(dir, '.claude/agents/reins-reviewer.md', 'edited\n');
  const own = await cli(dir, ['sync']);
  assert.match(own.stdout, /overwrote \.claude\/agents\/reins-reviewer\.md \(it had manual changes; edit \.reins\/agents\/reviewer\.md instead\)/);
});

test('removing a source removes its generated files (unless edited by hand)', async () => {
  const dir = repo();
  write(dir, '.reins/skills/custom/SKILL.md', '---\nname: custom\ndescription: custom skill\n---\nbody\n');
  write(dir, '.reins/agents/tester.md', '---\nname: tester\ndescription: tester agent\n---\nbody\n');
  await cli(dir, ['sync']);
  assert.ok(existsSync(path.join(dir, '.claude/skills/reins-custom/SKILL.md')));
  assert.ok(existsSync(path.join(dir, '.claude/agents/reins-tester.md')));

  rmSync(path.join(dir, '.reins/skills/custom'), { recursive: true });
  write(dir, '.claude/agents/reins-tester.md', 'my changes\n');
  rmSync(path.join(dir, '.reins/agents/tester.md'));

  const r = await cli(dir, ['sync']);
  assert.match(r.stdout, /removed \.claude\/skills\/reins-custom\/SKILL\.md \(source deleted\)/);
  assert.equal(existsSync(path.join(dir, '.claude/skills/reins-custom')), false, 'empty folder pruned');
  assert.match(r.stdout, /reins-tester\.md: its source is gone but it has manual changes; kept/);
  assert.equal(read(dir, '.claude/agents/reins-tester.md'), 'my changes\n');
  assert.equal((await cli(dir, ['sync', '--check'])).code, 0);
});

test('invalid settings.json and invalid sources are reported, not touched', async () => {
  const dir = repo();
  write(dir, '.claude/settings.json', '{ nope');
  write(dir, '.reins/skills/broken/SKILL.md', '---\nname: broken\n---\nno description\n');
  const r = await cli(dir, ['sync']);
  assert.match(r.stdout, /settings\.json is not valid JSON .+; not touched/);
  assert.match(r.stdout, /skills\/broken\/SKILL\.md: frontmatter needs a "description"/);
  assert.equal(read(dir, '.claude/settings.json'), '{ nope');
  assert.equal(existsSync(path.join(dir, '.claude/skills/reins-broken')), false);
});

test('reins check reports generated files out of sync under integrity, once sync was adopted', async () => {
  const dir = repo();
  await cli(dir, ['check', '--update-baseline']);
  assert.doesNotMatch((await cli(dir, ['check'])).stdout, /Generated file/, 'no manifest yet: nothing to compare');
  await cli(dir, ['sync']);
  write(dir, '.reins/notes/catalog.md', '---\npaths: ["src/features/catalog/**"]\n---\n- note\n');
  const r = await cli(dir, ['check']);
  assert.equal(r.code, 0, 'integrity is warn by default');
  assert.match(r.stdout, /! warn {2}integrity {2}\.reins\/\.generated\.json\n {4}Why: Generated file out of sync: AGENTS\.md: notes index out of date/);
});

test('mergeSettings: removes entries reins no longer wants, keeps everything else in place', () => {
  const previous = { deny: ['Bash(git commit:*)', 'Bash(old:*)'], hooks: [{ event: 'PreToolUse', matcher: 'Edit', command: 'old hook' }] };
  const current = JSON.stringify({ permissions: { deny: ['A', 'Bash(old:*)', 'Bash(git commit:*)', 'B'] }, hooks: { PreToolUse: [{ matcher: 'Edit', hooks: [{ type: 'command', command: 'old hook' }] }, { matcher: 'X', hooks: [] }] } });
  const r = mergeSettings(current, previous);
  const s = JSON.parse(r.text);
  assert.deepEqual(s.permissions.deny, ['A', 'Bash(git commit:*)', 'B', 'Bash(git push:*)']);
  assert.deepEqual(s.hooks.PreToolUse.map((e) => e.matcher), ['X', 'Read|Edit|Write|MultiEdit']);
  assert.deepEqual(r.owned.deny, SETTINGS.deny);
  assert.equal(mergeSettings(r.text, r.owned).changed, false);
});

test('mergeCursorHooks: adds the session start trigger next to the team\'s hooks, removes what reins no longer wants', () => {
  const created = mergeCursorHooks(null, { hooks: [] });
  assert.deepEqual(JSON.parse(created.text ?? ''), { version: 1, hooks: { sessionStart: [{ command: CURSOR_HOOKS[0].command }] } });
  assert.match(CURSOR_HOOKS[0].command, /^echo '\{\}' # reins: /, 'a no-op that prints valid JSON and says why it is there');

  const previous = { hooks: [{ event: 'stop', command: 'old reins hook' }] };
  const team = JSON.stringify({ version: 1, hooks: { sessionStart: [{ command: 'team.sh' }], stop: [{ command: 'old reins hook' }], afterFileEdit: [{ command: 'fmt.sh' }] } });
  const r = mergeCursorHooks(team, previous);
  assert.deepEqual(JSON.parse(r.text ?? ''), { version: 1, hooks: { sessionStart: [{ command: 'team.sh' }, { command: CURSOR_HOOKS[0].command }], afterFileEdit: [{ command: 'fmt.sh' }] } });
  assert.deepEqual(r.owned.hooks, [...CURSOR_HOOKS]);
  assert.equal(mergeCursorHooks(r.text, r.owned).changed, false);
  assert.match(mergeCursorHooks('{ nope', { hooks: [] }).problem ?? '', /\.cursor\/hooks\.json is not valid JSON.*not touched/);
});

test('notes index: parts of a module go on its line, so AGENTS.md does not grow a line per part', () => {
  const n = (file, ...paths) => ({ file: `.reins/notes/${file}.md`, paths });
  const block = renderNotesIndex([
    n('companies', 'src/app/(companies)/**'),
    n('companies/reviews', 'src/app/(companies)/companies/[slug]/reviews/**'),
    n('companies/salaries', 'src/app/(companies)/companies/[slug]/salaries/**'),
    n('jobs', 'src/app/jobs/**'),
    n('orphan/part', 'src/x/**'),
  ]);
  assert.equal(block, [
    '- `src/app/(companies)/**` → `.reins/notes/companies.md`; parts in `.reins/notes/companies/`: reviews, salaries\n',
    '- `src/app/jobs/**` → `.reins/notes/jobs.md`\n',
    '- `src/x/**` → `.reins/notes/orphan/part.md`\n',
  ].join(''));
});

test('notes index: at most two paths per note, so a big module does not flood AGENTS.md', () => {
  const block = renderNotesIndex([{ file: '.reins/notes/companies.md', paths: ['src/app/(companies)/companies/**', 'src/components/pages/companies/**', 'src/components/a.js', 'src/components/b.js'] }]);
  assert.equal(block, '- `src/app/(companies)/companies/**`, `src/components/pages/companies/**` (+2 more) → `.reins/notes/companies.md`\n');
});

test('notes block: always says how to get the notes; only the count when the index would break the AGENTS.md limit', () => {
  const n = (file, ...paths) => ({ file: `.reins/notes/${file}.md`, paths });
  const notes = [n('a', 'src/a/**'), n('a/x', 'src/a/x/**'), n('b', 'src/b/**'), n('c', 'src/c/**')];
  const full = fitNotesIndex(notes, 4);
  assert.equal(full.compact, false);
  assert.equal(full.block, `${HOW}. By path:\n${renderNotesIndex(notes)}`);
  const fit = fitNotesIndex(notes, 3);
  assert.equal(fit.compact, true);
  assert.equal(fit.block, `${HOW}. 4 notes in \`.reins/notes/\`, too many to list here.\n`);
  assert.deepEqual(fitNotesIndex([], 0), { block: '', compact: false });
});

test('sync never writes an AGENTS.md that doctor rejects: 40 notes still fit in the limit', async () => {
  const dir = repo();
  for (let i = 0; i < 40; i++) write(dir, `.reins/notes/m${i}.md`, `---\npaths: ["src/m${i}/**"]\n---\nok\n`);
  const r = await cli(dir, ['sync']);
  assert.match(r.stdout + r.stderr, /only says how to get the notes/);
  assert.match(read(dir, 'AGENTS.md'), /npx reins notes <path…>.+41 notes in/);
  assert.ok(read(dir, 'AGENTS.md').replace(/\s+$/, '').split('\n').length <= 45);
  assert.equal((await cli(dir, ['sync', '--check'])).code, 0);
  const doctor = await cli(dir, ['doctor', '--json'], { env: {} });
  assert.ok(!doctor.stdout.includes('agents-size'), doctor.stdout);

  write(dir, '.reins/doctor.yml', 'agents_md: { max_lines: 80 }\n');
  await cli(dir, ['sync']);
  assert.match(read(dir, 'AGENTS.md'), /By path:\n(.+\n)*- `src\/m0\/\*\*` → `\.reins\/notes\/m0\.md`/, 'a higher limit gets the full index back');
});

/** Example repo as reins 0.7.0 left it: rules written into AGENTS.md and defaults copied into .reins/. */
function legacyRepo() {
  const dir = exampleRepo('vite-react');
  const fixture = fileURLToPath(new URL('./fixtures/reins-0.7.0/', import.meta.url));
  cpSync(path.join(fixture, '.reins'), path.join(dir, '.reins'), { recursive: true });
  write(dir, 'AGENTS.md', read(fixture, 'AGENTS.txt'));
  return dir;
}

test('upgrading from reins 0.7: old rules move into the rules block and unmodified default copies are removed', async () => {
  const dir = legacyRepo();
  write(dir, '.reins/skills/done/SKILL.md', '---\ndescription: our own close\n---\nOur steps.\n'); // edited by hand: an override

  const check = await cli(dir, ['sync', '--check']);
  assert.equal(check.code, 1);
  assert.match(check.stdout, /\.reins\/skills\/audit\/SKILL\.md: unmodified copy of a reins default/);
  assert.match(check.stdout, /AGENTS\.md: rules written by an older reins/);

  const r = await cli(dir, ['sync']);
  assert.equal(r.code, 0, r.stderr);
  for (const f of ['.reins/skills/audit/SKILL.md', '.reins/agents/reviewer.md', '.reins/policies/triage.md']) {
    assert.equal(existsSync(path.join(dir, f)), false, `${f} removed`);
  }
  assert.deepEqual(readdirSync(path.join(dir, '.reins/policies')), ['README.md'], 'old copies gone, the folder stays with its README');
  assert.match(read(dir, '.reins/skills/done/SKILL.md'), /Our steps/, 'hand-edited copies stay as overrides');
  assert.match(read(dir, '.claude/skills/reins-done/SKILL.md'), /Generated by reins sync from \.reins\/skills\/done\/SKILL\.md/);
  assert.match(read(dir, '.claude/skills/reins-audit/SKILL.md'), /Generated by reins sync from \.reins\/core\/skills\/audit\/SKILL\.md/);

  const agents = read(dir, 'AGENTS.md');
  assert.equal(agents.match(/^## Always$/gm).length, 1, 'rules are not duplicated');
  assert.match(agents, /^# example-vite-react\nCommands: `npm run dev` · `npx reins check`\n\n<!-- reins:rules:start[^>]*-->\n## Always/);
  assert.match(agents, /\.reins\/core\/policies\/triage\.md/);
  assert.match((await cli(dir, ['sync'])).stdout, /nothing to do/);
  assert.equal((await cli(dir, ['sync', '--check'])).code, 0);
});

test('hand-edited rules in an AGENTS.md without markers are left alone with a warning', async () => {
  const dir = legacyRepo();
  write(dir, 'AGENTS.md', read(dir, 'AGENTS.md').replace('- Never use `--no-verify`.\n', '- Never use `--no-verify`.\n- Our own rule.\n'));
  const before = read(dir, 'AGENTS.md');
  const r = await cli(dir, ['sync']);
  assert.match(r.stdout, /AGENTS\.md has no reins rules markers/);
  assert.doesNotMatch(read(dir, 'AGENTS.md'), /reins:rules:start/);
  assert.equal(read(dir, 'AGENTS.md').split('<!-- reins:notes:start')[0], before.split('<!-- reins:notes:start')[0]);
});
