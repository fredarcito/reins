import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftNote, summarizeModule, parseNote, NOTE_TODO_RE } from '@reins/core';

const edges = [
  { from: 'src/app/page.js', to: 'src/features/cart/index.js' },
  { from: 'src/app/cart/page.js', to: 'src/features/cart/index.js' },
  { from: 'src/features/catalog/List.js', to: 'src/features/cart/index.js' },
  { from: 'src/features/cart/index.js', to: 'src/features/cart/store.js' },
  { from: 'src/features/cart/Summary.js', to: 'src/features/cart/store.js' },
  { from: 'src/features/cart/store.js', to: 'src/lib/money.js' },
];
const files = [...new Set(edges.flatMap((e) => [e.from, e.to])), 'src/features/cart/unused.js'];
const label = (f) => (f.startsWith('src/features/catalog/') ? 'domain catalog' : f.split('/').slice(0, 2).join('/'));

test('summarizeModule: own files, most imported first, who uses it and what it depends on', () => {
  const s = summarizeModule({ paths: ['src/features/cart/**'], files, edges, label });
  assert.deepEqual(s.files, ['src/features/cart/Summary.js', 'src/features/cart/index.js', 'src/features/cart/store.js', 'src/features/cart/unused.js']);
  assert.deepEqual(s.keyFiles.slice(0, 2), ['src/features/cart/index.js', 'src/features/cart/store.js']);
  assert.deepEqual([...s.usedBy], [['src/app', 2], ['domain catalog', 1]]);
  assert.deepEqual([...s.dependsOn], [['src/lib', 1]]);
});

test('draftNote: a valid note with the graph facts filled in and TODO lines for the rest', () => {
  const summary = summarizeModule({ paths: ['src/features/cart/**'], files, edges, label });
  const text = draftNote({ name: 'cart', paths: ['src/features/cart/**'], publicApi: ['src/features/cart/index.js'], summary, date: '2026-11-04' });
  const { note } = parseNote('.reins/notes/cart.md', text);
  assert.deepEqual(note.paths, ['src/features/cart/**']);
  assert.match(text, /^# cart\n<!-- Drafted by reins notes new on 2026-11-04\./m);
  assert.match(text, /- Public API: `src\/features\/cart\/index\.js`\n- Files: 4\. Most imported: `src\/features\/cart\/index\.js`, `src\/features\/cart\/store\.js`/);
  assert.match(text, /- Used by: src\/app \(2\), domain catalog \(1\)\n- Depends on: src\/lib \(1\)/);
  for (const h of ['Purpose', 'Map', 'How it works', 'Decisions', 'Traps']) assert.match(text, new RegExp(`^## ${h}$`, 'm'));
  assert.ok(NOTE_TODO_RE.test(note.body));
  assert.ok(text.split('\n').length <= 30, 'short enough to be read on every visit');

  const bare = draftNote({ name: 'x', paths: ['src/x/**'], publicApi: [], summary: null, date: '2026-11-04' });
  assert.doesNotMatch(bare, /Used by|Public API/);
  assert.ok(!NOTE_TODO_RE.test('## Purpose\nCart totals. The TODO list lives elsewhere.\n'), 'a word TODO inside a sentence is not a draft marker');
});
