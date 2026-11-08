import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo, git } from './helpers.js';
import { hookResponse } from '../src/commands/notes.js';

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
  assert.match(first.hookSpecificOutput.additionalContext, /^Module notes for src\/features\/billing\/tax\.ts \(from \.reins\/notes; follow them\):\n\nNote \.reins\/notes\/billing\.md/);
  assert.equal(call('src/features/billing/Invoice.tsx', 's1', 'Edit'), null, 'same note, same session: not repeated');
  assert.notEqual(call('src/lib/date.ts'), null, 'another note in the same session');
  assert.notEqual(call('src/features/billing/tax.ts', 's2'), null, 'a new session gets it again');
  const cursor = hookResponse(dir, { session_id: 'c1', hook_event_name: 'preToolUse', tool_name: 'Read', tool_input: { file_path: path.join(dir, 'src/features/billing/tax.ts') } });
  assert.equal(JSON.parse(cursor ?? '{}').hookSpecificOutput?.hookEventName, 'PreToolUse', 'Cursor runs this hook with its own spelling; the answer keeps Claude\'s (VERIFIED P12)');
  assert.equal(call('src/components/Button.tsx'), null, 'no note');
  assert.equal(hookResponse(dir, { session_id: 's3', tool_input: { file_path: '/etc/hosts' } }), null, 'outside the repo');
  assert.equal(hookResponse(dir, { session_id: 's3', tool_input: { command: 'ls' } }), null, 'no file path');
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
