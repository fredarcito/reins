import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo, git } from './helpers.js';
import { hookResponse, MAX_SHELL_PATHS, patchPaths, shellPaths } from '../src/commands/notes.js';
import { sessionId } from '../src/notebooks.js';

const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};

function repo() {
  const dir = exampleRepo('next-app');
  write(dir, '.reins/notes/billing.md', '---\npaths: ["src/features/billing/**", "src/app/orders/**"]\n---\n- 2026-11-01: taxes are computed server side.\n');
  write(dir, '.reins/notes/lib.md', '---\npaths: src/lib/**\n---\n- dates are UTC.\n');
  write(dir, '.reins/notes/_template.md', '---\npaths: ["src/**"]\n---\n- template, not a note\n');
  return dir;
}

test('notes <path>: prints the matching notes, skips templates, says when there are none', async () => {
  const dir = repo();
  const r = await cli(dir, ['notes', 'src/features/billing/tax.ts', 'src/components/Button.tsx']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Note \.reins\/notes\/billing\.md \(applies to src\/features\/billing\/\*\*, src\/app\/orders\/\*\*\) for src\/features\/billing\/tax\.ts:\n- 2026-11-01: taxes are computed server side\./);
  assert.match(r.stdout, /No notes for src\/components\/Button\.tsx\./);
  assert.doesNotMatch(r.stdout, /template, not a note/);

  const sub = await cli(path.join(dir, 'src/lib'), ['notes', 'date.ts', '--json']);
  assert.deepEqual(JSON.parse(sub.stdout).paths[0].notes.map((n) => n.file), ['.reins/notes/lib.md']);
});

test('notes: a broken note is reported, not fatal', async () => {
  const dir = repo();
  write(dir, '.reins/notes/broken.md', 'no frontmatter\n');
  const r = await cli(dir, ['notes', 'src/lib/date.ts']);
  assert.match(r.stdout, /! warning {2}\.reins\/notes\/broken\.md: missing frontmatter/);
  assert.match(r.stdout, /dates are UTC/);
});

test('hook: returns additionalContext for Read/Edit of a noted path, once per note and session', () => {
  const dir = repo();
  const call = (file, session = 's1', tool = 'Read') => hookResponse(dir, { session_id: session, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { file_path: path.join(dir, file) } });
  const first = JSON.parse(call('src/features/billing/tax.ts'));
  assert.equal(first.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(first.hookSpecificOutput.additionalContext, /^Module notes for src\/features\/billing\/tax\.ts \(from \.reins\/notes; start from them; the code wins if they disagree, and say so\):\n\nNote \.reins\/notes\/billing\.md/);
  // an edit in a session that measured nothing gets the triage reminder, but not the same note again
  const edit = JSON.parse(call('src/features/billing/Invoice.tsx', 's1', 'Edit') ?? '{}').hookSpecificOutput?.additionalContext ?? '';
  assert.match(edit, /^No level is measured for this task yet: before editing code, run `npx reins triage/);
  assert.doesNotMatch(edit, /billing\.md/, 'same note, same session: not repeated');
  assert.equal(call('src/features/billing/Invoice.tsx', 's1', 'Edit'), null, 'the reminder is once per session');
  assert.notEqual(call('src/lib/date.ts'), null, 'another note in the same session');
  assert.notEqual(call('src/features/billing/tax.ts', 's2'), null, 'a new session gets it again');
  const cursor = hookResponse(dir, { session_id: 'c1', hook_event_name: 'preToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, 'src/features/billing/tax.ts') } });
  assert.equal(JSON.parse(cursor ?? '{}').hookSpecificOutput?.hookEventName, 'PreToolUse', 'Cursor runs this hook with its own spelling; the answer keeps Claude\'s (VERIFIED P12)');
  assert.equal(call('src/components/Button.tsx'), null, 'no note');
  assert.equal(hookResponse(dir, { session_id: 's3', tool_input: { file_path: '/etc/hosts' } }), null, 'outside the repo');
  assert.equal(hookResponse(dir, { session_id: 's3', tool_input: { command: 'ls' } }), null, 'no file path');
  // Grep and Glob pass a folder: the notes of the files inside it
  const grep = JSON.parse(hookResponse(dir, { session_id: 's4', tool_name: 'Grep', tool_input: { pattern: 'tax', path: path.join(dir, 'src/features/billing') } }) ?? '{}');
  assert.match(grep.hookSpecificOutput?.additionalContext ?? '', /^Module notes for src\/features\/billing\/ /);
  assert.equal(hookResponse(dir, { session_id: 's5', tool_name: 'Glob', tool_input: { pattern: '**/*.ts', path: dir } }), null, 'the repo root says nothing');
  assert.equal(hookResponse(dir, { session_id: 's5', tool_name: 'Grep', tool_input: { pattern: 'x' } }), null, 'no path: the whole repo');
});

test('shellPaths: the existing paths a command names, after cd, without quotes, flags or :line', () => {
  const dir = repo();
  const found = shellPaths(`cd src && sed -n 1,80p "lib/date.ts:12" | grep -rn tax features/billing; rg -l x --glob '*.ts' ../package.json nowhere.js`, dir);
  assert.deepEqual(found.map((absolute) => path.relative(dir, absolute)), ['src', 'src/lib/date.ts', 'src/features/billing', 'package.json']);
  const many = shellPaths(`cat ${Array.from({ length: 20 }, () => 'src/lib/date.ts src/app').join(' ')} src/features src/components`, dir);
  assert.ok(many.length <= MAX_SHELL_PATHS);
});

test('shellPaths: git commands that only stage, commit or switch bring no paths; the ones that read code do', () => {
  const dir = repo();
  const relative = (command) => shellPaths(command, dir).map((absolute) => path.relative(dir, absolute));
  assert.deepEqual(relative('git add src/lib/date.ts && git commit -m x src/app'), []);
  assert.deepEqual(relative('git -C src checkout -- lib/date.ts; git stash push src/app'), []);
  assert.deepEqual(relative('git add src/app && git diff src/lib/date.ts'), ['src/lib/date.ts']);
  assert.deepEqual(relative('git log -p src/app'), ['src/app']);
});

test('hook: a note read directly counts as received, so it is not delivered again', () => {
  const dir = repo();
  const hook = (tool_name, tool_input) => hookResponse(dir, { session_id: 'd1', hook_event_name: 'PreToolUse', tool_name, cwd: dir, tool_input });
  assert.equal(hook('Read', { file_path: path.join(dir, '.reins/notes/lib.md') }), null);
  assert.equal(hook('Read', { file_path: path.join(dir, 'src/lib/date.ts') }), null, 'already read by hand');
  assert.match(JSON.parse(hook('Bash', { command: 'cat src/features/billing/tax.ts' }) ?? '{}').hookSpecificOutput?.additionalContext ?? '', /taxes are computed/);
});

test('shellPaths: shell edits name their files: inline code, glued redirections, new files', () => {
  const dir = repo();
  const relative = (command) => shellPaths(command, dir).map((absolute) => path.relative(dir, absolute));
  // repvue-employer, 2026-11-17: an agent edited with python one-liners and never got the module notes
  assert.deepEqual(relative(`python3 -c "p='src/lib/date.ts'; s=open(p).read(); open(p,'w').write(s)"`), ['src/lib/date.ts']);
  assert.deepEqual(relative(`node -e "require('fs').writeFileSync('src/lib/date.ts', x)"`), ['src/lib/date.ts']);
  assert.deepEqual(relative(`sed -i '' 's/a.ts/b.ts/' src/lib/date.ts`), ['src/lib/date.ts']);
  assert.deepEqual(relative('cat >src/lib/date.ts <<EOF\nx\nEOF'), ['src/lib/date.ts']);
  // a file about to be created: its folder exists
  assert.deepEqual(relative("cat > src/features/billing/new.ts <<'EOF'\nx\nEOF"), ['src/features/billing/new.ts']);
  assert.deepEqual(relative('cd src/lib && echo x > fresh.ts && touch other.ts'), ['src/lib', 'src/lib/fresh.ts', 'src/lib/other.ts']);
  // not files: a word without a folder, a missing folder, a sed expression, a URL
  assert.deepEqual(relative('echo nowhere.ts && cat src/missing/x.ts; curl http://localhost:3000/a.js'), []);
});

test('hook on Bash: a shell command that reads code gets the notes of the paths it names, never an impact or triage word', () => {
  const dir = repo();
  const bash = (command, session = 'b1') => {
    const response = hookResponse(dir, { session_id: session, hook_event_name: 'PreToolUse', tool_name: 'Bash', cwd: dir, tool_input: { command } });
    return response ? JSON.parse(response).hookSpecificOutput.additionalContext : null;
  };
  const read = bash('sed -n 1,40p src/features/billing/tax.ts && grep -n UTC src/lib');
  assert.match(read ?? '', /^Module notes for src\/features\/billing\/tax\.ts, src\/lib\/ \(from \.reins\/notes;/);
  assert.match(read ?? '', /taxes are computed server side[\s\S]*dates are UTC/);
  assert.equal(bash('cat src/features/billing/tax.ts'), null, 'once per note and session, shared with Read');
  assert.equal(bash('pnpm test && git status'), null, 'no path: nothing');
  assert.equal(bash('ls /etc'), null, 'outside the repo: nothing');
  assert.doesNotMatch(bash('cat src/lib/date.ts', 'b2') ?? '', /No level is measured|Impact of/, 'reading is not editing');
  // Cursor's shell tool is `Shell`, and it sends `cwd: ""` (VERIFIED P12): paths resolve from the project root
  const cursor = hookResponse(dir, { session_id: 'c1', hook_event_name: 'preToolUse', tool_name: 'Shell', cwd: '', tool_input: { command: 'cat src/lib/date.ts', cwd: '' } });
  assert.match(JSON.parse(cursor ?? '{}').hookSpecificOutput?.additionalContext ?? '', /^Module notes for src\/lib\/date\.ts/);
});

test('codex: apply_patch is an edit whose files come from the patch; the shell has CODEX_THREAD_ID', () => {
  const dir = repo();
  const patch = '*** Begin Patch\n*** Update File: src/features/billing/tax.ts\n@@\n-a\n+b\n*** Add File: src/lib/new.ts\n+x\n*** End Patch\n';
  assert.deepEqual(patchPaths(patch, dir).map((absolute) => path.relative(dir, absolute)), ['src/features/billing/tax.ts', 'src/lib/new.ts']);
  const response = hookResponse(dir, { session_id: 'x1', hook_event_name: 'PreToolUse', tool_name: 'apply_patch', cwd: dir, tool_input: { command: patch } });
  const context = JSON.parse(response ?? '{}').hookSpecificOutput?.additionalContext ?? '';
  assert.match(context, /^No level is measured for this task yet/, 'an edit before triage');
  assert.match(context, /taxes are computed server side[\s\S]*dates are UTC/, 'the notes of every file in the patch');
  assert.equal(sessionId({ CODEX_THREAD_ID: 'thread-1' }), 'thread-1');
  assert.equal(sessionId({ CLAUDE_CODE_SESSION_ID: 'claude-1', CODEX_THREAD_ID: 'thread-1' }), 'claude-1');
});

test('hook: the triage reminder is per session, and stops once the session measured its level', async () => {
  const dir = repo();
  const edit = (session) => {
    const response = hookResponse(dir, { session_id: session, hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { file_path: path.join(dir, 'src/new-file.ts') } });
    return response ? JSON.parse(response).hookSpecificOutput.additionalContext : null;
  };
  // another session measured its own task on this branch: that level is not this session's
  await cli(dir, ['triage', 'its task', '--files', 'src/lib/date.ts'], { env: { CLAUDE_CODE_SESSION_ID: 'other' } });
  assert.match(edit('t1') ?? '', /^No level is measured for this task yet/, 'a new file still gets the reminder');
  assert.equal(edit('t1'), null, 'once per session');
  await cli(dir, ['triage', 'my task', '--files', 'src/new-file.ts'], { env: { CLAUDE_CODE_SESSION_ID: 't2' } });
  assert.equal(edit('t2'), null, 'measured: silence');
  assert.equal(hookResponse(dir, { session_id: 't3', tool_name: 'Write', tool_input: { file_path: path.join(dir, '.reins/progress/x.md') } }), null, 'reins state: no reminder');
});

test('notes --hook never breaks the tool call: bad input prints nothing and exits 0', async () => {
  const dir = repo();
  const bad = await cli(dir, ['notes', '--hook'], { stdin: 'not json' });
  assert.deepEqual([bad.code, bad.stdout], [0, '']);
  const ok = await cli(dir, ['notes', '--hook'], { stdin: JSON.stringify({ session_id: 'x', tool_input: { file_path: path.join(dir, 'src/lib/time.ts') } }) });
  assert.equal(ok.code, 0);
  assert.match(JSON.parse(ok.stdout).hookSpecificOutput.additionalContext, /dates are UTC/);
});

test('scope: domains, public API, notes and minimum level; folders are expanded', async () => {
  const dir = repo();
  const small = await cli(dir, ['scope', 'src/features/billing/tax.ts', '--json']);
  assert.deepEqual(JSON.parse(small.stdout), {
    files: ['src/features/billing/tax.ts'], domains: ['billing'], publicApi: [], architecture: false,
    notes: ['.reins/notes/billing.md'], level: 'small', reasons: ['1 file(s) in 1 domain'], warnings: [],
  });

  const folder = JSON.parse((await cli(dir, ['scope', 'src/lib', '--json'])).stdout);
  assert.equal(folder.files.length, 4);
  assert.equal(folder.level, 'medium');

  const large = await cli(dir, ['scope', 'src/features/billing/tax.ts', 'src/features/orders/queries.ts']);
  assert.match(large.stdout, /Domains: billing, orders\n/);
  assert.match(large.stdout, /Minimum level: large \(2 domains \(billing, orders\)\)/);

  const arch = JSON.parse((await cli(dir, ['scope', '.reins/architecture.yml', '--json'])).stdout);
  assert.equal(arch.level, 'large');
  assert.equal((await cli(dir, ['scope'])).code, 2);
});

test('notes new <domain>: drafts the note from the graph; refuses to overwrite without --force', async () => {
  const dir = exampleRepo('next-app');
  const r = await cli(dir, ['notes', 'new', 'orders']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Drafted \.reins\/notes\/orders\.md\. Run `reins sync` to add it to the AGENTS\.md index, then ask your agent to fill in its TODO lines \(in Claude Code: \/reins-notes\)\./);
  const text = readFileSync(path.join(dir, '.reins/notes/orders.md'), 'utf8');
  assert.match(text, /^---\npaths: \["src\/features\/orders\/\*\*"\]\n---\n# orders\n/);
  assert.match(text, /- Public API: `src\/features\/orders\/index\.ts`/);
  assert.match(text, /- Files: 4\./);
  assert.match(text, /- Used by: .*src\/app/);
  assert.match(text, /- Depends on: .*src\/lib/);
  assert.match((await cli(dir, ['notes', 'src/features/orders/queries.ts'])).stdout, /Note \.reins\/notes\/orders\.md/);

  const again = await cli(dir, ['notes', 'new', 'orders']);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /orders\.md already exists\. Edit it, or pass --force/);
  assert.equal((await cli(dir, ['notes', 'new', 'orders', '--force'])).code, 0);
});

test('notes new <folder>: works without a domain, and without a graph (no architecture.yml)', async () => {
  const dir = exampleRepo('next-app', { keepReins: false });
  const r = await cli(dir, ['notes', 'new', 'src/lib']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Could not build the import graph/);
  const text = readFileSync(path.join(dir, '.reins/notes/lib.md'), 'utf8');
  assert.match(text, /^---\npaths: \["src\/lib\/\*\*"\]\n---\n# lib\n/);
  assert.doesNotMatch(text, /Used by/);
  const bad = await cli(dir, ['notes', 'new', 'nope']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /"nope" is not a domain of architecture\.yml nor a folder/);
});

test('notes new --name: chooses the file name; rejects paths', async () => {
  const dir = exampleRepo('next-app');
  const r = await cli(dir, ['notes', 'new', 'src/lib', '--name', 'shared-lib']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /Drafted \.reins\/notes\/shared-lib\.md/);
  assert.match(readFileSync(path.join(dir, '.reins/notes/shared-lib.md'), 'utf8'), /^---\npaths: \["src\/lib\/\*\*"\]\n---\n# shared-lib\n/);
  const bad = await cli(dir, ['notes', 'new', 'src/lib', '--name', '../x']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--name must be a file name .*or <module>\/<part>/);
  assert.equal((await cli(dir, ['notes', 'new', 'src/lib', '--name', 'a/b/c'])).code, 2);
  assert.equal((await cli(dir, ['notes', 'new', 'src/lib', '--name', 'shared/lib'])).code, 0);
  assert.ok(existsSync(path.join(dir, '.reins/notes/shared/lib.md')));
});

test('notes new <folder inside a domain>: the note is a part of it, in the domain folder; notes are read from folders', async () => {
  const dir = exampleRepo('next-app');
  mkdirSync(path.join(dir, 'src/features/orders/history'), { recursive: true });
  writeFileSync(path.join(dir, 'src/features/orders/history/List.ts'), 'export const List = 1;\n');
  const r = await cli(dir, ['notes', 'new', 'src/features/orders/history']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Drafted \.reins\/notes\/orders\/history\.md/);
  await cli(dir, ['notes', 'new', 'orders']);
  const shown = (await cli(dir, ['notes', 'src/features/orders/history/List.ts'])).stdout;
  assert.match(shown, /Note \.reins\/notes\/orders\.md[\s\S]*Note \.reins\/notes\/orders\/history\.md/);
});

test('notes stale: ranks notes by commits to their paths since they last changed', async () => {
  const dir = repo();
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'notes');
  write(dir, 'src/features/billing/tax.ts', 'export const tax = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'billing change');
  const r = await cli(dir, ['notes', 'stale']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^reins notes stale: 1 of 2 notes have commits to their paths since they last changed\.\n  \.reins\/notes\/billing\.md  1 commit\(s\), 1 file\(s\) since \d{4}-\d\d-\d\d\n  \.reins\/notes\/lib\.md  0 commit/);
  assert.match(r.stdout, /\/reins-notes review/);
  const json = JSON.parse((await cli(dir, ['notes', 'stale', '--json', '--limit', '1'])).stdout);
  assert.deepEqual(json.notes.map((n) => [n.file, n.commits]), [['.reins/notes/billing.md', 1]]);
  assert.equal((await cli(dir, ['notes', 'stale', '--limit', 'x'])).code, 2);
});

test('doctor: a note whose paths match nothing is reported even if the branch did not touch it', async () => {
  const dir = repo();
  write(dir, '.reins/notes/gone.md', '---\npaths: ["src/features/gone/**"]\n---\n- x\n');
  const r = await cli(dir, ['doctor']);
  assert.match(r.stdout, /note-dead-paths +\.reins\/notes\/gone\.md/);
  assert.match(r.stdout, /reaches nobody/);
});
