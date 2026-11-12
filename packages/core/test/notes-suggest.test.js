import { test } from 'node:test';
import assert from 'node:assert/strict';
import { notePurpose, suggestNotes, words } from '@agentreins/core';

const note = (name, paths, body = '') => ({ file: `.reins/notes/${name}.md`, paths, body });

test('words: lower case, no accents, camelCase split, stopwords and short words out', () => {
  assert.deepEqual(words('Agregar el filtro Company a JobMatches (matching) en página'), ['filtro', 'company', 'job', 'matches', 'matching']);
  assert.deepEqual(words('fix the HTTPServer bug'), ['http', 'server']);
});

test('suggestNotes: names and covered folders weigh more than the body; a folder the note never names still leads to it', () => {
  const candidates = note('sourceCandidates', ['src/components/pages/candidates/**'], '## Purpose\nSource Talent search page.');
  const billing = note('billing', ['src/features/billing/**'], '## Purpose\nInvoices. A company has many invoices.');
  const folders = ['src', 'src/components/pages/candidates', 'src/components/pages/candidates/JobMatches', 'src/features/billing'];
  const [first, ...rest] = suggestNotes('Add a Company filter to Job Matches', [billing, candidates], folders);
  assert.equal(first.note, candidates);
  assert.deepEqual(first.matched, ['job', 'matches']);
  assert.deepEqual(first.folders, ['src/components/pages/candidates/JobMatches']);
  // billing only mentions "company" once in its body: 1 point against 6, below the floor
  assert.deepEqual(rest, []);
});

test('suggestNotes: prefixes match (match, matches, matching), frequent body words count more, nothing for no match', () => {
  const a = note('a', ['src/a/**'], 'matching '.repeat(5));
  const b = note('b', ['src/b/**'], 'matching once');
  const r = suggestNotes('the matcher', [b, a]);
  assert.deepEqual(r.map((x) => [x.note.file, x.score]), [['.reins/notes/a.md', 2], ['.reins/notes/b.md', 1]]);
  assert.deepEqual(suggestNotes('zzz qqq', [a, b]), []);
  assert.deepEqual(suggestNotes('the and for', [a, b]), [], 'only stopwords');
  assert.equal(suggestNotes('matching', [a, b], [], { limit: 1 }).length, 1);
  assert.equal(suggestNotes('jobs', [note('job', ['src/job/**'])]).length, 1, 'plural');
  assert.deepEqual(suggestNotes('company', [note('compare', ['src/compare/**'])]), [], 'a 4-letter start is not a stem');
});

test('notePurpose: first sentence of ## Purpose; null when missing or a TODO; long ones are cut', () => {
  assert.equal(notePurpose('# x\n\n## Purpose\nThe `reins` command line: wires things. More.\n\n## Map\n- a'), 'The `reins` command line: wires things.');
  assert.equal(notePurpose('## Purpose\nNo full stop here\n'), 'No full stop here');
  assert.equal(notePurpose('## Purpose\nTODO: say what it does.\n'), null);
  assert.equal(notePurpose('- just a list'), null);
  const long = notePurpose(`## Purpose\n${'word '.repeat(40)}end.`, 30);
  assert.ok(long !== null && long.length <= 30 && long.endsWith('…'), long ?? '');
});
