import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo, git } from './helpers.js';
import { hookResponse as notesHook } from '../src/commands/notes.js';
import { hookResponse } from '../src/commands/resume.js';

const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};

/** A branch with a notebook, a code change and a note covering it. */
function repo() {
  const dir = exampleRepo('next-app');
  write(dir, '.reins/notes/orders.md', '---\npaths: ["src/features/orders/**"]\n---\n## Purpose\nOrders list.\n## Decisions\n- 2026-11-01: queries run on the server only.\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'note');
  git(dir, 'switch', '-qc', 'feat/filters');
  write(dir, 'src/features/orders/queries.ts', `${readFileSync(path.join(dir, 'src/features/orders/queries.ts'), 'utf8')}\nexport const byStatus = 1;\n`);
  write(dir, '.reins/progress/feat-filters.md', '# feat/filters · status: open · updated: 2026-11-04\n**Goal:** filter orders by status.\n**Next step:** add the select to OrderList.\n');
  return dir;
}

test('resume: notebook, changed files and their notes', async () => {
  const dir = repo();
  const r = await cli(dir, ['resume'], { env: { GITHUB_BASE_REF: 'main' } });
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^Context to resume the work on branch feat\/filters/);
  assert.match(r.stdout, /## Your notebook: \.reins\/progress\/feat-filters\.md\n.+\n\n# feat\/filters · status: open/);
  assert.match(r.stdout, /picked because it is the older one-per-branch notebook\. If the request is a different task, create a new one/);
  assert.match(r.stdout, /\*\*Next step:\*\* add the select to OrderList\./);
  assert.match(r.stdout, /## Files changed on this branch \(1\)\n- src\/features\/orders\/queries\.ts/);
  assert.match(r.stdout, /### \.reins\/notes\/orders\.md \(applies to src\/features\/orders\/\*\*\)\n## Purpose\nOrders list\./);
  const json = JSON.parse((await cli(dir, ['resume', '--json'], { env: { GITHUB_BASE_REF: 'main' } })).stdout);
  assert.deepEqual([json.branch, json.files, json.notes.map((n) => n.file)], ['feat/filters', ['src/features/orders/queries.ts'], ['.reins/notes/orders.md']]);
});

test('resume: nothing to resume on a clean branch; the hook then prints nothing', async () => {
  const dir = exampleRepo('next-app');
  assert.match((await cli(dir, ['resume'])).stdout, /^Nothing to resume on main: no progress notebook and no changes on this branch\./);
  const hook = await cli(dir, ['resume', '--hook'], { stdin: JSON.stringify({ session_id: 's', source: 'startup' }) });
  assert.deepEqual([hook.code, hook.stdout], [0, '']);
  const bad = await cli(dir, ['resume', '--hook'], { stdin: 'not json' });
  assert.deepEqual([bad.code, bad.stdout], [0, ''], 'never breaks the session start');
});

test('resume --hook: after a compaction the notes are delivered again, by both hooks', () => {
  const dir = repo();
  const env = { GITHUB_BASE_REF: 'main' };
  const start = JSON.parse(hookResponse(dir, { session_id: 's1', hook_event_name: 'SessionStart', source: 'startup' }, env));
  assert.equal(start.hookSpecificOutput.hookEventName, 'SessionStart');
  assert.match(start.hookSpecificOutput.additionalContext, /Next step:\*\* add the select/);
  assert.match(start.hookSpecificOutput.additionalContext, /queries run on the server only/);

  const read = (session) => notesHook(dir, { session_id: session, hook_event_name: 'PreToolUse', tool_input: { file_path: path.join(dir, 'src/features/orders/OrderList.tsx') } });
  assert.equal(read('s1'), null, 'the session start already delivered the note');

  const compacted = JSON.parse(hookResponse(dir, { session_id: 's1', hook_event_name: 'SessionStart', source: 'compact' }, env));
  assert.match(compacted.hookSpecificOutput.additionalContext, /Next step:\*\* add the select/);
  assert.match(compacted.hookSpecificOutput.additionalContext, /queries run on the server only/, 'notes come back after a compaction');
  assert.equal(read('s1'), null, 'and the read hook does not repeat them right after');

  write(dir, '.reins/progress/.notes-seen.json', JSON.stringify({ s1: ['.reins/notes/orders.md'] }));
  const notesOnlyByRead = JSON.parse(hookResponse(dir, { session_id: 's1', source: 'compact' }, env)).hookSpecificOutput.additionalContext;
  assert.match(notesOnlyByRead, /queries run on the server only/, 'a note first seen through a Read also comes back after a compaction');
});
