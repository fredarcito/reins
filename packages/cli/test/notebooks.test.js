// Several tasks and sessions on one branch (docs/proposals/multi-session-progress.md, phase 1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo, git } from './helpers.js';
import { hookResponse } from '../src/commands/resume.js';

const read = (dir, f) => readFileSync(path.join(dir, f), 'utf8');
const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};
const as = (session) => ({ env: session ? { CLAUDE_CODE_SESSION_ID: session } : {} });
const CSS = '.reins/progress/feat-checkout/css/notebook.md';
const LOGIN = '.reins/progress/feat-checkout/login/notebook.md';

/** feat/checkout with the "css" task created by session s1, goal and item in progress filled in. */
async function branchWithTask() {
  const dir = exampleRepo('vite-react');
  git(dir, 'switch', '-qc', 'feat/checkout');
  await cli(dir, ['progress', 'new', 'css'], as('s1'));
  write(dir, CSS, read(dir, CSS).replace('**Goal:** one or two lines.', '**Goal:** refactor the checkout CSS.').replace('- [~] ...', '- [~] checkout buttons'));
  return dir;
}

test('tasks one after another: a new session never takes the open task silently, and writes only its own', async () => {
  const dir = await branchWithTask();
  assert.match(read(dir, CSS), /^# feat\/checkout · task: css · session: s1 · status: open/);

  const fresh = (await cli(dir, ['resume'], as('s2'))).stdout;
  assert.match(fresh, /## Other open tasks on this branch \(other sessions' work: read them, never edit them\)\n- css — refactor the checkout CSS\.\n {2}in progress: checkout buttons \(updated 2026-11-04\)/);
  assert.match(fresh, /No task chosen for this session yet\. If the request continues one of these tasks, continue it: pass `--task <name>`/);
  assert.doesNotMatch(fresh, /## Your/);
  const refused = await cli(dir, ['progress', 'add', 'x'], as('s2'));
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /No task chosen for this session\. Open tasks on feat\/checkout:\n {2}- css: refactor the checkout CSS\./);

  const css = read(dir, CSS);
  await cli(dir, ['progress', 'new', 'login'], as('s2'));
  await cli(dir, ['progress', 'add', 'fix', 'the', 'redirect'], as('s2'));
  assert.match(read(dir, LOGIN), /- \[ \] fix the redirect/);
  assert.equal(read(dir, CSS), css, 'the other task is untouched');
  assert.match((await cli(dir, ['progress', 'show'], as('s1'))).stdout, /feat-checkout\/css\/notebook\.md/, 'each session finds its own task');
  assert.match((await cli(dir, ['triage', 'small', 'one more'], as('s2'))).stdout, / \| task:login\n$/, 'the triage line carries the task name');
});

test('the same task from a new session, after a compaction, and without a session id', async () => {
  const dir = await branchWithTask();
  assert.match((await cli(dir, ['progress', 'show', '--task', 'css'], as('s3'))).stdout, /in progress|checkout buttons/);
  assert.match(read(dir, CSS), /session: s3/, 'continuing a task claims it');
  const own = JSON.parse(hookResponse(dir, { session_id: 's3', source: 'compact' }, {}, '2026-11-04')).hookSpecificOutput.additionalContext;
  assert.match(own, /## Your task css: \.reins\/progress\/feat-checkout\/css\/notebook\.md/);
  assert.doesNotMatch(own, /has not claimed/);
  assert.match((await cli(dir, ['progress', 'show', '--task', 'nope'], as('s3'))).stderr, /Task "nope" has no notebook on feat\/checkout/);

  assert.match((await cli(dir, ['progress', 'show'], { env: { CURSOR_CONVERSATION_ID: 's3' } })).stdout, /feat-checkout\/css\/notebook\.md/, 'Cursor\'s agent shell has its session id too');
  const cursor = JSON.parse(hookResponse(dir, { session_id: 's3', hook_event_name: 'sessionStart' }, {}, '2026-11-04')).hookSpecificOutput;
  assert.deepEqual([cursor.hookEventName, /## Your task css/.test(cursor.additionalContext)], ['SessionStart', true], 'Cursor\'s spelling is answered in Claude\'s');

  const noId = (await cli(dir, ['resume'], as(null))).stdout;
  assert.match(noId, /## Your task css/, 'no session id and one open task: as before');
  assert.match(noId, /it was picked because it is the only open task\. If the request is a different task, create a new one/);
  await cli(dir, ['progress', 'new', 'login'], as(null));
  assert.match((await cli(dir, ['progress', 'show'], as(null))).stderr, /No task chosen/, 'with two open tasks, none is guessed');
});

/** Marks every item of a notebook done, as an agent does at the end of the done skill. */
const finish = (dir, f) => write(dir, f, read(dir, f).replace(/- \[[ ~]\]/g, '- [x]'));

test('closing: the agent closes with a command; closed tasks take one line, only while others are open', async () => {
  const dir = await branchWithTask();
  await cli(dir, ['progress', 'new', 'login'], as('s2'));
  finish(dir, CSS);
  finish(dir, LOGIN);
  assert.match((await cli(dir, ['progress', 'close'], as('s1'))).stdout, /Closed css\. reins deletes its notebook 7 days from now\./);
  assert.match(read(dir, CSS), /status: closed/);
  const r = (await cli(dir, ['resume'], as('s4'))).stdout;
  assert.match(r, /- login [^]*?\nDone: css\.\n/);
  await cli(dir, ['progress', 'close'], as('s2'));
  assert.match((await cli(dir, ['resume'], as('s4'))).stdout, /^Nothing to resume on feat\/checkout/, 'closed notebooks are never current work');
});

test('close refuses while the done steps are not finished: open items, then flagged notes unless --notes-ok says why', async () => {
  const dir = await branchWithTask();
  const refused = await cli(dir, ['progress', 'close'], as('s1'));
  assert.equal(refused.code, 2);
  assert.match(refused.stderr, /Not closed: the done steps are not finished \(the done skill/);
  assert.match(refused.stderr, /Items still open\. Mark each one done[^]*\n {2}\d+\. \[~\] checkout buttons/);
  assert.match(read(dir, CSS), /status: open/);

  finish(dir, CSS);
  const note = '.reins/notes/ui.md';
  write(dir, note, '---\npaths: ["src/ui/**"]\n---\n# ui\n\n## Purpose\nShared UI.\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-qm', 'ui note');
  await cli(dir, ['triage', 'small', 'css'], as('s1'));
  for (const c of ['Button', 'Card', 'Modal', 'Tabs']) write(dir, `src/ui/${c}.jsx`, `export const ${c} = () => null;\n`); // medium: doctor checks notes
  const notes = await cli(dir, ['progress', 'close'], as('s1'));
  assert.equal(notes.code, 2);
  assert.match(notes.stderr, /Module notes the doctor flags[^]*note-outdated \.reins\/notes\/ui\.md/);
  assert.doesNotMatch(notes.stderr, /Items still open/);

  assert.match((await cli(dir, ['progress', 'close', '--notes-ok', ' '], as('s1'))).stderr, /--notes-ok needs the reason/);
  assert.match((await cli(dir, ['progress', 'close', '--notes-ok', 'only a placeholder component'], as('s1'))).stdout, /Closed css\./);
  assert.match(read(dir, CSS), /status: closed[^]*\*\*Next step:\*\* Closed with module notes unchanged: only a placeholder component/);
});

test('doctor checks every notebook of the branch', async () => {
  const dir = await branchWithTask();
  write(dir, LOGIN, '# feat/checkout · task: login · status: open · updated: 2026-11-04\n- [~] a\n- [~] b\n');
  const r = JSON.parse((await cli(dir, ['doctor', '--json'])).stdout);
  assert.deepEqual(r.violations.map((v) => [v.rule, v.from]), [['progress-format', LOGIN]]);
});

test('resume cleans up: closed after 7 days, gone branches; never open work of a live branch', async () => {
  const dir = exampleRepo('vite-react');
  git(dir, 'branch', 'feat/live');
  const nb = (f, status, updated) => write(dir, f, `# x · status: ${status} · updated: ${updated}\n**Goal:** g.\n`);
  const old = new Date('2026-10-01T12:00:00Z');
  nb('.reins/progress/feat-live/old-closed/notebook.md', 'closed', '2026-10-20');
  nb('.reins/progress/feat-live/new-closed/notebook.md', 'closed', '2026-11-01');
  nb('.reins/progress/feat-live/paused/notebook.md', 'open', '2026-01-01');
  write(dir, '.reins/progress/feat-live/paused/decisions.md', 'kept with its task');
  nb('.reins/progress/feat-gone/merged/notebook.md', 'open', '2026-10-01');
  utimesSync(path.join(dir, '.reins/progress/feat-gone/merged/notebook.md'), old, old);
  nb('.reins/progress/feat-gone/recent/notebook.md', 'open', '2026-11-03');
  nb('.reins/progress/feat-old.md', 'closed', '2026-10-01');
  write(dir, '.reins/progress/feat-old/decisions.md', 'cold file of the older notebook');
  write(dir, '.reins/progress/triage.log', '');

  const r = (await cli(dir, ['resume'])).stdout;
  assert.match(r, /Removed the open notebook of task merged: branch x no longer exists and the notebook had not changed for 7 days\./);
  assert.doesNotMatch(r, /closed/, 'closed notebooks go silently');
  const left = (f) => existsSync(path.join(dir, '.reins/progress', f));
  assert.deepEqual(
    ['feat-live/old-closed', 'feat-live/new-closed', 'feat-live/paused/decisions.md', 'feat-gone/merged', 'feat-gone/recent', 'feat-old.md', 'feat-old', 'triage.log'].map(left),
    [false, true, true, false, true, false, false, true],
  );
});
