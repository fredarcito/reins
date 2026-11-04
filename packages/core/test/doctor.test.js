import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDoctorConfig, DOCTOR_DEFAULTS, parseTriageLog, scopeSignals, suggestLevel, runDoctor,
  parseNotebook, formatProblems, notebookFile, formatText, DOCTOR_RULES,
} from '@harness/core';

const domains = [
  { name: 'billing', paths: ['src/features/billing/**'], publicApi: ['src/features/billing/index.js'] },
  { name: 'search', paths: ['src/features/search/**'], publicApi: ['src/features/search/index.js'] },
];
const ARCH = '.harness/architecture.yml';
const LOG = '.harness/progress/triage.log';

/** Runs the doctor with sensible empty inputs, overridden by `over`. */
const doctor = (over = {}) =>
  runDoctor({
    config: parseDoctorConfig(null),
    branch: 'feat/x',
    changedFiles: [],
    domains,
    architectureFile: ARCH,
    triageLog: { file: LOG, text: null },
    agentsMd: { file: 'AGENTS.md', text: '# x\n' },
    notebooks: [],
    ...over,
  });
const rules = (r) => r.violations.map((v) => v.rule);

test('doctor.yml: defaults, partial overrides, clear errors', () => {
  assert.deepEqual(parseDoctorConfig(null), DOCTOR_DEFAULTS);
  const c = parseDoctorConfig('triage:\n  small: { max_files: 5 }\nprogress: { hot_max_lines: 60 }\n');
  assert.deepEqual(c.triage.small, { max_files: 5, max_domains: 1 });
  assert.equal(c.progress.hot_max_lines, 60);
  assert.equal(c.agents_md.max_lines, 30);
  assert.throws(() => parseDoctorConfig('triage:\n  tiny: {}\nagents_md: { max_lines: -1 }\n', { file: 'd.yml' }), {
    message: 'd.yml is not valid:\n  - triage.tiny: unknown key (expected one of: small, medium)\n  - agents_md.max_lines: expected a whole number ≥ 0',
  });
});

test('triage.log: entries, comments and malformed lines', () => {
  const log = parseTriageLog('# comment\n2026-11-04 | feat/x | small | fix the button\nnot a line\n2026-11-04 | feat/x | huge | x\n\n2026-11-05 | main | large | a | b\n');
  assert.deepEqual(log.entries.map((e) => [e.line, e.branch, e.level, e.reason]), [[2, 'feat/x', 'small', 'fix the button'], [6, 'main', 'large', 'a | b']]);
  assert.deepEqual(log.malformed.map((m) => m.line), [3, 4]);
});

test('suggested level: the thresholds of `harness scope`', () => {
  const t = DOCTOR_DEFAULTS.triage;
  const level = (files) => suggestLevel(scopeSignals(files, domains, ARCH), t).level;
  assert.equal(level(['src/features/billing/a.js', 'src/features/billing/b.js']), 'small');
  assert.equal(level(['README.md']), 'small');
  assert.equal(level(['src/features/billing/a.js', 'src/features/billing/b.js', 'src/features/billing/c.js', 'src/lib/d.js']), 'medium');
  assert.equal(level(['src/features/billing/a.js', 'src/features/search/b.js']), 'large');
  assert.equal(level(['src/features/billing/index.js']), 'large');
  assert.equal(level([ARCH]), 'large');
  const s = suggestLevel(scopeSignals(['src/features/billing/index.js', ARCH], domains, ARCH), t);
  assert.deepEqual(s.reasons, ['touches a public API (src/features/billing/index.js)', 'touches architecture.yml']);
});

test('triage-missing: a diff without a line for the branch; nothing without a diff', () => {
  assert.deepEqual(rules(doctor()), []);
  const r = doctor({ changedFiles: ['src/a.js'], triageLog: { file: LOG, text: '2026-11-04 | other | small | x\n' } });
  assert.deepEqual(rules(r), ['triage-missing']);
  assert.match(r.violations[0].message, /Branch feat\/x has 1 changed file\(s\) but no line in/);
  assert.match(r.violations[0].fix, /\| feat\/x \| <small\|medium\|large> \| <reason>/);
  assert.deepEqual(rules(doctor({ changedFiles: ['src/a.js'] })), ['triage-missing'], 'no triage.log at all');
});

test('triage-mismatch: the latest line of the branch is compared with the diff', () => {
  const files = ['src/features/billing/a.js', 'src/features/billing/b.js', 'src/features/billing/c.js', 'src/features/billing/d.js'];
  const r = doctor({ changedFiles: files, triageLog: { file: LOG, text: '2026-11-04 | feat/x | small | tweak billing\n' } });
  assert.deepEqual(rules(r), ['triage-mismatch']);
  assert.match(r.violations[0].message, /Declared small \(line 1: "tweak billing"\), but the diff looks medium: 4 files \(small allows 3\)/);

  const escalated = doctor({ changedFiles: files, triageLog: { file: LOG, text: '2026-11-04 | feat/x | small | a\n2026-11-04 | feat/x | medium | it grew\n' } });
  assert.deepEqual(rules(escalated), []);
  const large = doctor({ changedFiles: ['README.md'], triageLog: { file: LOG, text: '2026-11-04 | feat/x | large | refactor\n' } });
  assert.deepEqual(rules(large), [], 'declaring more than needed is not flagged');
});

test('malformed triage lines are reported even without a diff', () => {
  assert.deepEqual(rules(doctor({ triageLog: { file: LOG, text: 'oops\n' } })), ['triage-missing']);
});

test('agents-size', () => {
  const long = Array.from({ length: 31 }, (_, i) => `line ${i}`).join('\n') + '\n\n';
  assert.deepEqual(rules(doctor({ agentsMd: { file: 'AGENTS.md', text: long } })), ['agents-size']);
  assert.deepEqual(rules(doctor({ agentsMd: { file: 'AGENTS.md', text: null } })), []);
});

const notebook = (body, status = 'open') => `# feat/x · status: ${status} · updated: 2026-11-04
**Goal:** add discounts.
**Done criteria:**
${body.criteria ?? '- [x] discount applied\n- [x] `harness check` without new violations'}
**Subtasks:**
${body.subtasks ?? '- [x] model\n- [~] UI\n- [-] coupons — out of scope, ticket 42'}
**Next step:** wire the UI.
`;
const nb = (text) => doctor({ notebooks: [{ file: notebookFile('feat/x'), text }] });

test('a valid notebook produces nothing', () => {
  assert.equal(notebookFile('feat/x'), '.harness/progress/feat-x.md');
  assert.deepEqual(rules(nb(notebook({}))), []);
  assert.deepEqual(formatProblems(parseNotebook(notebook({}))), []);
});

test('progress-hot-size', () => {
  const text = notebook({ subtasks: Array.from({ length: 40 }, (_, i) => `- [ ] step ${i}`).join('\n') });
  assert.deepEqual(rules(nb(text)), ['progress-hot-size']);
});

test('progress-format: two [~], an invalid marker, [-] without reason, bad header', () => {
  const r = nb(notebook({ subtasks: '- [~] a\n- [~] b\n- [?] c\n- [-] d' }));
  assert.deepEqual(rules(r), ['progress-format']);
  assert.match(r.violations[0].message, /invalid marker \[\?\]/);
  assert.match(r.violations[0].message, /discarded item without a reason/);
  assert.match(r.violations[0].message, /2 items in progress \[~\]; only one at a time/);
  assert.match(formatProblems(parseNotebook('no header\n- [ ] x'))[0], /missing header/);
  assert.match(formatProblems(parseNotebook('# b · status: done · updated: today'))[0], /status must be open or closed/);
});

test('progress-closed: closed with unchecked done criteria (subtasks don\'t count)', () => {
  const r = nb(notebook({ criteria: '- [x] discount applied\n- [ ] tests pass', subtasks: '- [ ] leftover idea' }, 'closed'));
  assert.deepEqual(rules(r), ['progress-closed']);
  assert.match(r.violations[0].message, /closed but 1 criterion is not done \(line 5\)/);
  assert.deepEqual(rules(nb(notebook({ subtasks: '- [ ] leftover idea' }, 'closed'))), []);
});

test('every doctor finding is a warning with rule, why and fix; the result never fails by itself', () => {
  const r = doctor({
    changedFiles: ['src/a.js'],
    agentsMd: { file: 'AGENTS.md', text: 'x\n'.repeat(40) },
    notebooks: [{ file: 'n.md', text: notebook({ subtasks: '- [~] a\n- [~] b' }, 'closed').replace('- [x] discount', '- [ ] discount') + 'x\n'.repeat(40) }],
  });
  assert.deepEqual(rules(r).sort(), ['agents-size', 'progress-closed', 'progress-format', 'progress-hot-size', 'triage-missing']);
  assert.ok(r.violations.every((v) => v.severity === 'warn' && v.message && v.fix && DOCTOR_RULES.includes(v.rule)));
  assert.equal(r.ok, true);
  const text = formatText(r, { title: 'harness doctor', baseline: false });
  assert.match(text, /harness doctor: 0 errors, 5 warnings$/);
  assert.doesNotMatch(text, /baseline|Result:/);
  assert.equal(formatText(doctor(), { title: 'harness doctor', baseline: false }), 'harness doctor: nothing to report');
});
