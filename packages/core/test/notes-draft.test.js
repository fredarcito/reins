import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftNote, summarizeModule, parseNote, notesFor, parentNoteFile, pathsInside, NOTE_TODO_RE } from '@agentreins/core';

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

test('notesFor: most general note first, whatever the file order', () => {
  const notes = [
    { file: '.reins/notes/companies/salaries.md', paths: ['src/app/(companies)/companies/[slug]/salaries/**'], body: '' },
    { file: '.reins/notes/companies.md', paths: ['src/app/(companies)/**'], body: '' },
    { file: '.reins/notes/jobs.md', paths: ['src/app/jobs/**'], body: '' },
  ];
  const f = 'src/app/(companies)/companies/[slug]/salaries/countries/page.js';
  assert.deepEqual(notesFor(f, notes).map((n) => n.file), ['.reins/notes/companies.md', '.reins/notes/companies/salaries.md']);
  assert.deepEqual(notesFor('src/app/(companies)/x.js', notes).map((n) => n.file), ['.reins/notes/companies.md']);
});

test('draftNote: a module lists its parts with their notes; a part points to its module for the shared context', () => {
  const parentText = draftNote({ name: 'companies', paths: ['src/app/(companies)/**'], publicApi: [], summary: null, date: '2026-11-05',
    submodules: [{ name: 'companies/salaries', folder: 'src/app/(companies)/companies/[slug]/salaries' }, { name: 'companies/reviews', folder: 'src/app/(companies)/companies/[slug]/reviews' }] });
  assert.match(parentText, /- Parts with their own note \(read it too when working there\): `salaries\/`, `reviews\/` -> `\.reins\/notes\/companies\/<part>\.md`/);
  const odd = draftNote({ name: 'companies', paths: ['x/**'], publicApi: [], summary: null, date: '2026-11-05', submodules: [{ name: 'companies/jobs-2', folder: 'x/(b)/jobs' }] });
  assert.match(odd, /`jobs\/` -> `\.reins\/notes\/companies\/jobs-2\.md`/, 'a renamed part is listed with its own file');
  const partText = draftNote({ name: 'companies/salaries', paths: ['src/app/(companies)/companies/[slug]/salaries/**'], publicApi: [], summary: null, date: '2026-11-05', parent: 'companies' });
  assert.match(partText, /TODO: what this part of companies does, in one or two lines\. `\.reins\/notes\/companies\.md` has the shared context/);
  assert.ok(parseNote('x.md', partText).note);
});

test('parts of a module: parent note from the location, paths inside its folders', () => {
  assert.equal(parentNoteFile('.reins/notes/companies/salaries.md'), '.reins/notes/companies.md');
  assert.equal(parentNoteFile('.reins/notes/companies.md'), null);
  assert.equal(parentNoteFile('.reins/notes/a/b/c.md'), null);
  const mod = { paths: ['src/app/(companies)/**', 'src/components/company/**'] };
  assert.ok(pathsInside({ paths: ['src/app/(companies)/companies/[slug]/salaries/**', 'src/components/company/salary/**'] }, mod));
  assert.ok(!pathsInside({ paths: ['src/app/(companies)/x/**', 'src/lib/**'] }, mod));
});
