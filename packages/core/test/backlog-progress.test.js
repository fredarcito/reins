import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACKLOG_HEADER, parseBacklog, addFinding, setStatus, markRecheck,
  parseNotebook, formatProblems, listItems, markDone, markStarted, markDropped, addItem, setNext, newNotebook, NotebookError,
} from '@harness/core';

const D = '2026-11-04';
const template = (name) => readFileSync(new URL(`../../../templates/.harness/templates/${name}`, import.meta.url), 'utf8');

// ---------------- backlog ----------------

test('backlog: add numbers findings and refuses duplicates (including wontfix ones)', () => {
  let r = addFinding(null, { path: 'src/features/cart/', finding: 'Memoize the totals.', date: D });
  assert.equal(r.id, 'A1');
  assert.ok(r.text.startsWith(BACKLOG_HEADER));
  r = addFinding(r.text, { path: 'src/lib/format.js', finding: 'Cache  Intl.NumberFormat\n per locale.', date: D });
  assert.equal(r.id, 'A2');
  assert.match(r.text, /- \[open\] A2 · 2026-11-04 · `src\/lib\/format\.js` · Cache Intl\.NumberFormat per locale\.\n$/);
  const closed = setStatus(r.text, { id: 'A1', status: 'wontfix', reason: 'the list has 3 items', date: D });
  assert.throws(() => addFinding(closed, { path: 'src/features/cart/', finding: 'memoize the totals.', date: D }), /Already recorded as A1 \(wontfix: the list has 3 items\)/);
  assert.throws(() => addFinding(closed, { path: 'a`b', finding: 'x', date: D }), /backticks/);
});

test('backlog: status changes need a reason (except reopening) and clear recheck', () => {
  let t = addFinding(null, { path: 'a', finding: 'one', date: D }).text;
  t = addFinding(t, { path: 'b', finding: 'two', date: D }).text;
  assert.throws(() => setStatus(t, { id: 'A1', status: 'done', reason: '', date: D }), /reason for done can't be empty/);
  assert.throws(() => setStatus(t, { id: 'A9', status: 'done', reason: 'x', date: D }), /No finding A9/);
  assert.throws(() => setStatus(t, { id: 'A1', status: 'closed', reason: 'x', date: D }), /Status must be one of/);
  const m = markRecheck(t, 'open');
  assert.deepEqual(m.marked, ['A1', 'A2']);
  t = setStatus(m.text, { id: 'A1', status: 'done', reason: 'memoized', date: '2026-11-06' });
  const items = parseBacklog(t).items;
  assert.deepEqual(items.map((it) => [it.id, it.status, it.recheck, it.resolution?.reason ?? null]), [['A1', 'done', false, 'memoized'], ['A2', 'open', true, null]]);
  t = setStatus(t, { id: 'A1', status: 'open', reason: '', date: D });
  assert.equal(parseBacklog(t).items[0].resolution, null);
});

test('backlog: invalid files are reported and never edited', () => {
  const broken = `${BACKLOG_HEADER}\n- [open] A1 · 2026-11-04 · \`a\` · ok\n- [maybe] A2 · nope\n- [done] A3 · 2026-11-04 · \`b\` · no reason\n`;
  assert.deepEqual(parseBacklog(broken).problems, ['line 6 is not a valid finding: "- [maybe] A2 · nope"', 'line 7: done without a reason (— done YYYY-MM-DD: reason)']);
  assert.throws(() => addFinding(broken, { path: 'c', finding: 'd', date: D }), /has format problems; fix them first/);
  const kept = `${BACKLOG_HEADER}\nSome prose the person wrote.\n\n- [open] A1 · 2026-11-04 · \`a\` · ok\n`;
  assert.match(addFinding(kept, { path: 'c', finding: 'd', date: D }).text, /Some prose the person wrote\./);
});

// ---------------- notebook edits ----------------

test('notebook: new from the templates is valid; show numbers items in file order', () => {
  for (const name of ['progress-mini.md', 'progress-hot.md']) {
    const nb = newNotebook(template(name), 'feat/x', D);
    assert.deepEqual(formatProblems(parseNotebook(nb)), [], name);
    assert.match(nb, /^# feat\/x · status: open · updated: 2026-11-04/);
  }
  const items = listItems(newNotebook(template('progress-mini.md'), 'b', D));
  assert.deepEqual(items.map((it) => [it.n, it.marker, it.section]), [[1, ' ', 'done criteria'], [2, ' ', 'done criteria'], [3, '~', 'subtasks'], [4, ' ', 'subtasks']]);
});

test('notebook: add, start (only one [~]), done, drop with reason, next; date updated', () => {
  let t = newNotebook(template('progress-mini.md'), 'b', '2026-11-01');
  t = addItem(t, 'subtasks', 'wire the UI', D);
  t = addItem(t, 'criteria', 'discount shown in the cart', D);
  const started = markStarted(t, 6, D);
  assert.deepEqual(started.paused, [4]);
  t = markDone(started.text, 6, D);
  t = markDropped(t, 5, 'not needed after all', D);
  t = setNext(t, 'write the tests', D);
  assert.deepEqual(formatProblems(parseNotebook(t)), []);
  assert.match(t, /updated: 2026-11-04/);
  assert.match(t, /\*\*Done criteria:\*\*\n- \[ \] \.\.\.\n- \[ \] `harness check` without new violations\n- \[ \] discount shown in the cart\n/);
  assert.match(t, /- \[-\] \.\.\. — not needed after all/);
  assert.match(t, /\*\*Next step:\*\* write the tests\n$/);
});

test('notebook: bad edits are refused with a clear message, invalid notebooks are not edited', () => {
  const t = newNotebook(template('progress-mini.md'), 'b', D);
  assert.throws(() => markDone(t, 99, D), /No item 99 \(the notebook has 4\)/);
  assert.throws(() => markDropped(t, 1, '  ', D), /reason can't be empty/);
  assert.throws(() => addItem(t, 'subtasks', '', D), /item can't be empty/);
  assert.throws(() => addItem(t.replace('**Subtasks:**', '**Steps:**'), 'subtasks', 'x', D), /no "Subtasks" section/);
  const broken = t.replace('- [ ] ...', '- [~] two in progress');
  assert.throws(() => markDone(broken, 1, D), (e) => e instanceof NotebookError && /not valid; fix it first:\n {2}- lines 4, 7: 2 items in progress/.test(e.message));
});

test('notebook: no sequence of edits ever produces an invalid notebook (500 random sequences)', () => {
  let seed = 42;
  const rand = (n) => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31;
    return seed % n;
  };
  const texts = ['', 'x', 'fix — it', '   ', '- [ ] nested', '**bold**', '`code`', 'ñandú 💡'];
  let refused = 0;
  for (let run = 0; run < 500; run++) {
    let t = newNotebook(template(run % 2 ? 'progress-hot.md' : 'progress-mini.md'), `b${run}`, D);
    for (let step = 0; step < 12; step++) {
      const n = rand(15) - 1; // includes 0 and out-of-range numbers
      const s = texts[rand(texts.length)];
      const ops = [
        () => addItem(t, rand(2) ? 'subtasks' : 'criteria', s, D),
        () => markStarted(t, n, D).text,
        () => markDone(t, n, D),
        () => markDropped(t, n, s, D),
        () => setNext(t, s, D),
      ];
      try {
        t = ops[rand(ops.length)]();
      } catch (e) {
        assert.ok(e instanceof NotebookError, e.message);
        refused++;
      }
      assert.deepEqual(formatProblems(parseNotebook(t)), [], `run ${run} step ${step}`);
    }
  }
  assert.ok(refused > 100, 'invalid edits were exercised');
});
