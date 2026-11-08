// Mechanical edits of the progress notebook, so the agent doesn't rewrite the whole file.
// Every edit parses the notebook, refuses to work on an invalid one, applies one change, bumps
// `updated:` and validates the result: an edit can never leave the notebook badly formatted.
import { HEADER_RE, ITEM_RE, formatHeader, formatProblems, parseNotebook } from './progress.js';

const SECTION_HEADER = (name) => new RegExp(`^(?:\\*\\*${name}:?\\*\\*|#{2,6}\\s+${name}:?)\\s*(.*)$`, 'i');
export const SECTIONS = Object.freeze({ criteria: 'Done criteria', subtasks: 'Subtasks', next: 'Next step' });

export class NotebookError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotebookError';
  }
}

/** Parses and throws when invalid. */
function valid(text) {
  const nb = parseNotebook(text);
  const problems = formatProblems(nb);
  if (problems.length) throw new NotebookError(`The notebook is not valid; fix it first:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  return nb;
}

/** Applies the date and re-validates. */
function finish(lines, date) {
  const i = lines.findIndex((l) => HEADER_RE.test(l));
  lines[i] = lines[i].replace(/(updated:\s*)\S+/, `$1${date}`);
  const text = lines.join('\n');
  const problems = formatProblems(parseNotebook(text));
  if (problems.length) throw new NotebookError(`Internal error: the edit would break the notebook (${problems.join('; ')}). Nothing was written.`);
  return text;
}

const clean = (s, what) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) throw new NotebookError(`${what} can't be empty.`);
  return t;
};

/** Numbered items (1-based, file order), for `reins progress show` and the other commands. */
export function listItems(text) {
  return valid(text).items.map((it, i) => ({ n: i + 1, ...it }));
}

function itemAt(nb, n) {
  const it = nb.items[n - 1];
  if (!Number.isInteger(n) || !it) throw new NotebookError(`No item ${n} (the notebook has ${nb.items.length}). Run \`reins progress show\`.`);
  return it;
}

function setMarkerLine(lines, it, marker, text) {
  const m = ITEM_RE.exec(lines[it.line - 1]);
  lines[it.line - 1] = `${m[1]}[${marker}]${m[3] || ' '}${text ?? m[4]}`;
}

/** `[x]` done (written; tested or not is said in the closing message). */
export function markDone(text, n, date) {
  const nb = valid(text);
  const lines = [...nb.lines];
  setMarkerLine(lines, itemAt(nb, n), 'x');
  return finish(lines, date);
}

/** `[~]` in progress. Another item in progress goes back to `[ ]` (only one at a time). */
export function markStarted(text, n, date) {
  const nb = valid(text);
  const lines = [...nb.lines];
  const target = itemAt(nb, n);
  const previous = nb.items.filter((it) => it.marker === '~' && it !== target);
  for (const it of previous) setMarkerLine(lines, it, ' ');
  setMarkerLine(lines, target, '~');
  return { text: finish(lines, date), paused: previous.map((it) => nb.items.indexOf(it) + 1) };
}

/** `[-]` discarded with a reason. The item stays, so the idea isn't proposed again. */
export function markDropped(text, n, reason, date) {
  const nb = valid(text);
  const lines = [...nb.lines];
  const it = itemAt(nb, n);
  const why = clean(reason, 'The reason');
  setMarkerLine(lines, it, '-', `${it.text.replace(/\s+—\s+.*$/, '')} — ${why}`);
  return finish(lines, date);
}

/**
 * Adds `- [ ] text` at the end of a section ("subtasks" or "criteria").
 * @param {'subtasks'|'criteria'} section
 */
export function addItem(text, section, itemText, date) {
  const nb = valid(text);
  const lines = [...nb.lines];
  const name = SECTIONS[section];
  if (!name || section === 'next') throw new NotebookError('Items go in "subtasks" or "criteria".');
  const header = lines.findIndex((l) => SECTION_HEADER(name).test(l.trim()));
  if (header === -1) throw new NotebookError(`The notebook has no "${name}" section. Add a line \`**${name}:**\` first.`);
  let at = header + 1;
  while (at < lines.length && ITEM_RE.test(lines[at])) at++;
  lines.splice(at, 0, `- [ ] ${clean(itemText, 'The item')}`);
  return finish(lines, date);
}

/** Replaces the "Next step" line (adds it at the end when missing). */
export function setNext(text, next, date) {
  const nb = valid(text);
  const lines = [...nb.lines];
  const line = `**${SECTIONS.next}:** ${clean(next, 'The next step')}`;
  const i = lines.findIndex((l) => SECTION_HEADER(SECTIONS.next).test(l.trim()));
  if (i === -1) {
    while (lines.length && lines[lines.length - 1] === '') lines.pop();
    lines.push(line, '');
  } else lines[i] = line;
  return finish(lines, date);
}

/**
 * A new notebook from a template: fills `<branch>` and the date, and puts `task:` and `session:` in the header.
 * @param {{ task?: string | null, session?: string | null }} [fields]
 */
export function newNotebook(template, branch, date, { task = null, session = null } = {}) {
  const text = template.replaceAll('<branch>', branch).replace(/updated:\s*YYYY-MM-DD/, `updated: ${date}`);
  if (!task && !session) return text;
  const lines = text.split('\n');
  const i = lines.findIndex((l) => HEADER_RE.test(l));
  if (i === -1) return text;
  const h = /** @type {RegExpExecArray} */ (HEADER_RE.exec(lines[i]));
  lines[i] = formatHeader({ branch: h[1], task: task ?? h[2], session: session ?? h[3], status: h[4], updated: h[5] });
  return lines.join('\n');
}

/**
 * Sets header fields: `session` (a session claims the task) or `status` (closing). Bumps the date. The notebook must
 * be valid. Returns the text unchanged when nothing changes.
 * @param {{ session?: string, status?: 'open' | 'closed' }} fields
 */
export function setHeader(text, fields, date) {
  const nb = valid(text);
  const h = /** @type {import('./progress.js').NotebookHeader} */ (nb.header);
  const next = { ...h, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v)) };
  if (next.session === h.session && next.status === h.status) return text;
  const lines = [...nb.lines];
  lines[h.line - 1] = formatHeader(next);
  return finish(lines, date);
}
