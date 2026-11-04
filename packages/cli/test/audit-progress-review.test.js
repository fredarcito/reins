import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo, git } from './helpers.js';
import { buildReviewPrompt } from '../src/commands/review.js';

const read = (dir, f) => readFileSync(path.join(dir, f), 'utf8');
const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};
const BACKLOG = '.reins/backlog/optimizations.md';

test('audit: add, list, recheck, set with reason; the backlog stays readable markdown', async () => {
  const dir = exampleRepo('vite-react');
  assert.match((await cli(dir, ['audit', 'list'])).stdout, /doesn't exist yet/);
  assert.match((await cli(dir, ['audit', 'add', 'src/lib/format.js', 'Cache Intl.NumberFormat'])).stdout, /Added A1\./);
  await cli(dir, ['audit', 'add', 'src/features/cart/', 'Memoize totals']);
  const dup = await cli(dir, ['audit', 'add', 'src/lib/format.js', 'cache intl.numberformat']);
  assert.equal(dup.code, 2);
  assert.match(dup.stderr, /Already recorded as A1 \(open\)/);

  assert.match((await cli(dir, ['audit', 'recheck', 'open'])).stdout, /Flagged for recheck: A1, A2\./);
  assert.match((await cli(dir, ['audit', 'list', '--recheck'])).stdout, /\[open\] \[recheck\] A1/);
  const noReason = await cli(dir, ['audit', 'set', 'A1', 'done']);
  assert.equal(noReason.code, 2);
  assert.match(noReason.stderr, /reason for done can't be empty/);
  const wontfix = await cli(dir, ['audit', 'set', 'A2', 'wontfix', 'only', '3', 'items']);
  assert.match(wontfix.stdout, /A2 is now wontfix\.\nIf the reason is durable, add it to the module note/);

  const list = await cli(dir, ['audit', 'list', '--status', 'all']);
  assert.match(list.stdout, /\[wontfix\] A2 · \d{4}-\d{2}-\d{2} · `src\/features\/cart\/` · Memoize totals — wontfix \d{4}-\d{2}-\d{2}: only 3 items/);
  assert.match(list.stdout, /\(1 open, 0 done, 1 wontfix; 1 to recheck\)/);
  assert.match(read(dir, BACKLOG), /^# Optimization backlog/);
  assert.deepEqual(JSON.parse((await cli(dir, ['audit', 'list', '--json'])).stdout).items.map((i) => i.id), ['A1']);
});

test('progress: new, show, add, start, done, drop, next — always valid', async () => {
  const dir = exampleRepo('vite-react');
  git(dir, 'checkout', '-q', '-b', 'feat/discounts');
  const file = '.reins/progress/feat-discounts.md';
  assert.match((await cli(dir, ['progress', 'show'])).stderr, /doesn't exist\. Create it with `reins progress new`/);
  assert.match((await cli(dir, ['progress', 'new'])).stdout, /Created \.reins\/progress\/feat-discounts\.md \(mini\)/);
  assert.equal((await cli(dir, ['progress', 'new'])).code, 2, 'never overwrites');

  await cli(dir, ['progress', 'add', 'apply', 'the', 'discount']);
  await cli(dir, ['progress', 'add', '--criteria', 'total shows the discount']);
  assert.match((await cli(dir, ['progress', 'start', '6'])).stdout, /Item 6 is in progress\. Item 4 went back to pending\./);
  await cli(dir, ['progress', 'done', '6']);
  await cli(dir, ['progress', 'drop', '5', 'covered', 'by', 'item', '6']);
  await cli(dir, ['progress', 'next', 'run', 'reins check']);
  const show = await cli(dir, ['progress', 'show']);
  assert.match(show.stdout, /done criteria:\n {3}1\. \[ \] \.\.\.\n {3}2\. \[ \] `reins check` without new violations\n {3}3\. \[ \] total shows the discount\nsubtasks:/);
  assert.match(show.stdout, / 6\. \[x\] apply the discount/);
  assert.match(show.stdout, /Next step: run reins check$/m);

  const before = read(dir, file);
  const bad = await cli(dir, ['progress', 'done', '42']);
  assert.equal(bad.code, 2);
  assert.equal(read(dir, file), before, 'a refused edit writes nothing');
  assert.match((await cli(dir, ['doctor'])).stdout, /reins doctor: nothing to report/, 'the edited notebook passes the doctor (and local files are not part of the diff)');
});

test('progress: an invalid notebook is refused, --hot creates the cold folder, --branch picks another notebook', async () => {
  const dir = exampleRepo('vite-react');
  await cli(dir, ['progress', 'new', '--hot', '--branch', 'feat/big']);
  for (const f of ['feat-big.md', 'feat-big/decisions.md', 'feat-big/verification.md', 'feat-big/delivery.md']) {
    assert.ok(existsSync(path.join(dir, '.reins/progress', f)), f);
  }
  write(dir, '.reins/progress/feat-big.md', '# feat/big · status: open · updated: 2026-11-04\n- [~] a\n- [~] b\n');
  const r = await cli(dir, ['progress', 'done', '1', '--branch', 'feat/big']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /not valid; fix it first:\n {2}- lines 2, 3: 2 items in progress/);
  assert.match((await cli(dir, ['progress', 'show', '--branch', 'feat/big'])).stdout, /! warning {2}lines 2, 3/);
});

test('review: prompt with checklist, notes, changed and untracked files; no changes, bad options', async () => {
  const dir = exampleRepo('vite-react');
  assert.match((await cli(dir, ['review'])).stdout, /No changes compared to main: nothing to review\./);
  git(dir, 'checkout', '-q', '-b', 'feat/x');
  write(dir, '.reins/notes/cart.md', '---\npaths: ["src/features/cart/**"]\n---\n- totals are cents.\n');
  write(dir, 'src/features/cart/cartStore.js', 'export function useCart() {\n  return { total: 2500 };\n}\n');
  write(dir, 'src/features/cart/discount.js', 'export const discount = 0.1;\n');
  write(dir, '.reins/progress/feat-x.md', 'local notebook, never reviewed\n');
  const r = await cli(dir, ['review']);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^# Code review request\n/);
  assert.match(r.stdout, /## Files changed \(3, compared to main\)\n\n- \.reins\/notes\/cart\.md\n- src\/features\/cart\/cartStore\.js\n- src\/features\/cart\/discount\.js\n/);
  assert.match(r.stdout, /## Checklist\n\n# Review checklist/);
  assert.match(r.stdout, /## Module notes for these paths\n\n### \.reins\/notes\/cart\.md\n\n- totals are cents\./);
  assert.match(r.stdout, /-  return \{ total: 2400 \};\n\+  return \{ total: 2500 \};/);
  assert.match(r.stdout, /\+export const discount = 0\.1;/, 'untracked files are in the diff');
  assert.doesNotMatch(r.stdout, /local notebook/);

  assert.match((await cli(dir, ['review', '--executor', 'openai'])).stderr, /Unknown executor "openai"\. Available: print/);
  assert.match((await cli(dir, ['review', '--max-bytes', '10'])).stderr, /--max-bytes must be/);
});

test('review: long diffs are truncated with a notice', () => {
  const p = buildReviewPrompt({ diff: 'x'.repeat(5000), files: ['a'], checklist: '- [ ] ok', notes: [], base: 'main', maxBytes: 1000 });
  assert.match(p, /x{1000}\n… \[diff truncated at 1000 bytes; review the rest file by file\]/);
});

test('progress new uses the repo templates in .reins/templates/ first, and refuses one that is not a notebook', async () => {
  const dir = exampleRepo('vite-react');
  git(dir, 'checkout', '-q', '-b', 'feat/ticket');
  mkdirSync(path.join(dir, '.reins/templates/progress-cold'), { recursive: true });
  writeFileSync(path.join(dir, '.reins/templates/progress-mini.md'), '# <branch> · status: open · updated: YYYY-MM-DD\n**Ticket:** ...\n**Goal:** ...\n**Done criteria:**\n- [ ] ...\n**Subtasks:**\n- [ ] ...\n**Next step:** ...\n');
  assert.equal((await cli(dir, ['progress', 'new'])).code, 0);
  assert.match(readFileSync(path.join(dir, '.reins/progress/feat-ticket.md'), 'utf8'), /^# feat\/ticket · status: open · updated: 2026-11-04\n\*\*Ticket:\*\* \.\.\./);

  writeFileSync(path.join(dir, '.reins/templates/progress-cold/decisions.md'), '# <branch> · our decisions\n');
  await cli(dir, ['progress', 'new', '--hot', '--branch', 'feat/big']);
  assert.equal(readFileSync(path.join(dir, '.reins/progress/feat-big/decisions.md'), 'utf8'), '# feat/big · our decisions\n');
  assert.ok(existsSync(path.join(dir, '.reins/progress/feat-big/verification.md')), 'missing cold templates come from the package');

  writeFileSync(path.join(dir, '.reins/templates/progress-mini.md'), 'just some text\n');
  const bad = await cli(dir, ['progress', 'new', '--branch', 'feat/other']);
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /^\.reins\/templates\/progress-mini\.md doesn't produce a valid notebook:\n {2}- missing header/);
  assert.equal(existsSync(path.join(dir, '.reins/progress/feat-other.md')), false);
});
