// The progress notebook: .reins/progress/<branch>.md (local, outside git). Format:
//
//   # <branch> · status: open · updated: YYYY-MM-DD
//   **Goal:** …
//   **Done criteria:**
//   - [ ] …
//   **Subtasks:**
//   - [~] …            in progress (only one)
//   - [x] …            written, not tested
//   - [-] … — reason   discarded, with a reason (never deleted)
//   **Next step:** …
//
// Shared by `doctor` (warnings) and `reins progress` (edits that must keep the format valid).

export const MARKERS = Object.freeze({ ' ': 'pending', '~': 'in progress', x: 'done', '-': 'discarded' });
export const HEADER_RE = /^#\s+(.+?)\s+[·|]\s+status:\s*(\S+)\s+[·|]\s+updated:\s*(\S+)\s*$/;
export const ITEM_RE = /^(\s*[-*]\s+)\[(.?)\](\s*)(.*)$/;
const SECTION_RE = /^(?:\*\*(.+?):?\*\*|#{2,6}\s+(.+?)):?\s*(.*)$/;
const REASON_RE = /(—|--|\breason:)\s*\S/i;

/** Notebook file for a branch (slashes and other unsafe characters become "-"). */
export const notebookFile = (branch) => `.reins/progress/${branch.replace(/[^\w.-]+/g, '-')}.md`;

/**
 * @typedef {{ line: number, marker: string, text: string, section: string }} NotebookItem
 * @typedef {{ header: { branch: string, status: string, updated: string, line: number } | null, items: NotebookItem[], lines: string[] }} Notebook
 */

/** @param {string} text @returns {Notebook} */
export function parseNotebook(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let header = null;
  let section = '';
  const items = [];
  lines.forEach((raw, i) => {
    const h = HEADER_RE.exec(raw);
    if (h && !header) {
      header = { branch: h[1], status: h[2], updated: h[3], line: i + 1 };
      return;
    }
    const item = ITEM_RE.exec(raw);
    if (item) {
      items.push({ line: i + 1, marker: item[2], text: item[4], section });
      return;
    }
    const s = SECTION_RE.exec(raw.trim());
    if (s) section = (s[1] ?? s[2]).trim().toLowerCase();
  });
  return { header, items, lines };
}

/** Lines that count against the size limit (trailing blank lines don't). */
export const countLines = (text) => text.replace(/\s+$/, '').split('\n').length;

/**
 * Format problems of a notebook: header, markers, one [~], reasons on [-]. Empty when valid.
 * @param {Notebook} nb
 * @returns {string[]}
 */
export function formatProblems(nb) {
  const problems = [];
  if (!nb.header) problems.push('missing header `# <branch> · status: open|closed · updated: YYYY-MM-DD` on the first lines');
  else {
    if (!['open', 'closed'].includes(nb.header.status)) problems.push(`line ${nb.header.line}: status must be open or closed, not "${nb.header.status}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(nb.header.updated)) problems.push(`line ${nb.header.line}: updated must be a date YYYY-MM-DD`);
  }
  for (const it of nb.items) {
    const m = it.marker === 'X' ? 'x' : it.marker;
    if (!(m in MARKERS)) problems.push(`line ${it.line}: invalid marker [${it.marker}] (use [ ], [~], [x] or [-])`);
    else if (m === '-' && !REASON_RE.test(it.text)) problems.push(`line ${it.line}: discarded item without a reason (write \`- [-] task — reason\`)`);
  }
  const inProgress = nb.items.filter((it) => it.marker === '~');
  if (inProgress.length > 1) problems.push(`lines ${inProgress.map((it) => it.line).join(', ')}: ${inProgress.length} items in progress [~]; only one at a time`);
  return problems;
}

/**
 * progress-hot-size, progress-format and progress-closed for one notebook.
 * @param {{ file: string, text: string, maxLines: number }} input
 * @returns {import('../check/shared.js').Violation[]}
 */
export function checkNotebook({ file, text, maxLines }) {
  const out = [];
  const add = (rule, message, fix) => out.push({ rule, severity: 'warn', key: `${rule}|${file}`, from: file, message, fix });
  const nb = parseNotebook(text);

  const n = countLines(text);
  if (n > maxLines) {
    add('progress-hot-size', `${file} has ${n} lines; the hot notebook limit is ${maxLines}.`,
      'Keep only what is needed to resume (goal, criteria, open subtasks, next step). Move decisions and history to the cold folder next to it.');
  }
  const problems = formatProblems(nb);
  if (problems.length) {
    add('progress-format', `${file} is not in the notebook format: ${problems.join('; ')}.`,
      'Fix those lines by hand; afterwards prefer `reins progress` edits, which keep the format valid.');
  }
  if (nb.header?.status === 'closed') {
    const criteria = nb.items.filter((it) => it.section.startsWith('done criteria'));
    const scope = criteria.length ? criteria : nb.items;
    const open = scope.filter((it) => it.marker !== 'x' && it.marker !== 'X' && it.marker !== '-');
    if (open.length) {
      add('progress-closed', `${file} is closed but ${open.length} criteri${open.length === 1 ? 'on is' : 'a are'} not done (line${open.length === 1 ? '' : 's'} ${open.map((it) => it.line).join(', ')}).`,
        'Only the person closes a task. Reopen it (status: open) or mark what was really done.');
    }
  }
  return out;
}
