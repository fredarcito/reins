import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo } from './helpers.js';
import { hookResponse } from '../src/commands/notes.js';

const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};

function repo() {
  const dir = exampleRepo('next-app');
  write(dir, '.harness/notes/billing.md', '---\npaths: ["src/features/billing/**", "src/app/orders/**"]\n---\n- 2026-11-01: taxes are computed server side.\n');
  write(dir, '.harness/notes/lib.md', '---\npaths: src/lib/**\n---\n- dates are UTC.\n');
  write(dir, '.harness/notes/_template.md', '---\npaths: ["src/**"]\n---\n- template, not a note\n');
  return dir;
}

test('notes <path>: prints the matching notes, skips templates, says when there are none', async () => {
  const dir = repo();
  const r = await cli(dir, ['notes', 'src/features/billing/tax.ts', 'src/components/Button.tsx']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^Note \.harness\/notes\/billing\.md \(applies to src\/features\/billing\/\*\*, src\/app\/orders\/\*\*\) for src\/features\/billing\/tax\.ts:\n- 2026-11-01: taxes are computed server side\./);
  assert.match(r.stdout, /No notes for src\/components\/Button\.tsx\./);
  assert.doesNotMatch(r.stdout, /template, not a note/);

  const sub = await cli(path.join(dir, 'src/lib'), ['notes', 'date.ts', '--json']);
  assert.deepEqual(JSON.parse(sub.stdout).paths[0].notes.map((n) => n.file), ['.harness/notes/lib.md']);
});

test('notes: a broken note is reported, not fatal', async () => {
  const dir = repo();
  write(dir, '.harness/notes/broken.md', 'no frontmatter\n');
  const r = await cli(dir, ['notes', 'src/lib/date.ts']);
  assert.match(r.stdout, /! warning {2}\.harness\/notes\/broken\.md: missing frontmatter/);
  assert.match(r.stdout, /dates are UTC/);
});

test('hook: returns additionalContext for Read/Edit of a noted path, once per note and session', () => {
  const dir = repo();
  const call = (file, session = 's1', tool = 'Read') => hookResponse(dir, { session_id: session, hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { file_path: path.join(dir, file) } });
  const first = JSON.parse(call('src/features/billing/tax.ts'));
  assert.equal(first.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.match(first.hookSpecificOutput.additionalContext, /^Module notes for src\/features\/billing\/tax\.ts \(from \.harness\/notes; follow them\):\n\nNote \.harness\/notes\/billing\.md/);
  assert.equal(call('src/features/billing/Invoice.tsx', 's1', 'Edit'), null, 'same note, same session: not repeated');
  assert.notEqual(call('src/lib/date.ts'), null, 'another note in the same session');
  assert.notEqual(call('src/features/billing/tax.ts', 's2'), null, 'a new session gets it again');
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
    notes: ['.harness/notes/billing.md'], level: 'small', reasons: ['1 file(s) in 1 domain'], warnings: [],
  });

  const folder = JSON.parse((await cli(dir, ['scope', 'src/lib', '--json'])).stdout);
  assert.equal(folder.files.length, 4);
  assert.equal(folder.level, 'medium');

  const large = await cli(dir, ['scope', 'src/features/billing/tax.ts', 'src/features/orders/queries.ts']);
  assert.match(large.stdout, /Domains: billing, orders\n/);
  assert.match(large.stdout, /Minimum level: large \(2 domains \(billing, orders\)\)/);

  const arch = JSON.parse((await cli(dir, ['scope', '.harness/architecture.yml', '--json'])).stdout);
  assert.equal(arch.level, 'large');
  assert.equal((await cli(dir, ['scope'])).code, 2);
});

test('notes new <domain>: drafts the note from the graph; refuses to overwrite without --force', async () => {
  const dir = exampleRepo('next-app');
  const r = await cli(dir, ['notes', 'new', 'orders']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Drafted \.harness\/notes\/orders\.md\. Fill in the TODO lines/);
  const text = readFileSync(path.join(dir, '.harness/notes/orders.md'), 'utf8');
  assert.match(text, /^---\npaths: \["src\/features\/orders\/\*\*"\]\n---\n# orders\n/);
  assert.match(text, /- Public API: `src\/features\/orders\/index\.ts`/);
  assert.match(text, /- Files: 4\./);
  assert.match(text, /- Used by: .*src\/app/);
  assert.match(text, /- Depends on: .*src\/lib/);
  assert.match((await cli(dir, ['notes', 'src/features/orders/queries.ts'])).stdout, /Note \.harness\/notes\/orders\.md/);

  const again = await cli(dir, ['notes', 'new', 'orders']);
  assert.equal(again.code, 2);
  assert.match(again.stderr, /orders\.md already exists\. Edit it, or pass --force/);
  assert.equal((await cli(dir, ['notes', 'new', 'orders', '--force'])).code, 0);
});

test('notes new <folder>: works without a domain, and without a graph (no architecture.yml)', async () => {
  const dir = exampleRepo('next-app', { keepHarness: false });
  const r = await cli(dir, ['notes', 'new', 'src/lib']);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Could not build the import graph/);
  const text = readFileSync(path.join(dir, '.harness/notes/lib.md'), 'utf8');
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
  assert.match(r.stdout, /Drafted \.harness\/notes\/shared-lib\.md/);
  assert.match(readFileSync(path.join(dir, '.harness/notes/shared-lib.md'), 'utf8'), /^---\npaths: \["src\/lib\/\*\*"\]\n---\n# shared-lib\n/);
  const bad = await cli(dir, ['notes', 'new', 'src/lib', '--name', '../x']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /--name must be a plain file name/);
});
