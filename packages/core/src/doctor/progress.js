// The progress notebook: one per task, .reins/progress/<branch>/<task>/notebook.md (local, outside git). The task
// folder also holds the task's cold files (decisions, verification, agent reports). The older one-per-branch
// .reins/progress/<branch>.md is still read, as a task with no name; its cold files are the plain files of
// .reins/progress/<branch>/. Format:
//
//   # <branch> · task: <task> · session: <id> · status: open · updated: YYYY-MM-DD   (task and session optional)
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
export const HEADER_RE = /^#\s+(.+?)(?:\s+[·|]\s+task:\s*(\S+))?(?:\s+[·|]\s+session:\s*(\S+))?\s+[·|]\s+status:\s*(\S+)\s+[·|]\s+updated:\s*(\S+)\s*$/;
export const ITEM_RE = /^(\s*[-*]\s+)\[(.?)\](\s*)(.*)$/;
const SECTION_RE = /^(?:\*\*(.+?):?\*\*|#{2,6}\s+(.+?)):?\s*(.*)$/;
const REASON_RE = /(—|--|\breason:)\s*\S/i;

export const PROGRESS_DIR = '.reins/progress';
export const NOTEBOOK_NAME = 'notebook.md';
/** Folder of a branch's tasks (slashes and other unsafe characters become "-"). */
export const branchFolder = (branch) => `${PROGRESS_DIR}/${branch.replace(/[^\w.-]+/g, '-')}`;
/** Task names: what the agent may pick, and what `task:` in a header may hold. */
export const TASK_RE = /^[A-Za-z0-9][\w.-]*$/;
/** Where a task's cold files and agent reports go; without a task, the older per-branch cold folder. */
export const taskFolder = (branch, task = null) => (task ? `${branchFolder(branch)}/${task}` : branchFolder(branch));
/** Notebook of a task, or the older per-branch notebook without one. */
export const notebookFile = (branch, task = null) => (task ? `${taskFolder(branch, task)}/${NOTEBOOK_NAME}` : `${branchFolder(branch)}.md`);

/**
 * @typedef {{ line: number, marker: string, text: string, section: string }} NotebookItem
 * @typedef {{ branch: string, task: string | null, session: string | null, status: string, updated: string, line: number }} NotebookHeader
 * @typedef {{ header: NotebookHeader | null, items: NotebookItem[], lines: string[] }} Notebook
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
      header = { branch: h[1], task: h[2] ?? null, session: h[3] ?? null, status: h[4], updated: h[5], line: i + 1 };
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

/** The header line for these fields. */
export const formatHeader = ({ branch, task = null, session = null, status, updated }) =>
  `# ${[branch, task && `task: ${task}`, session && `session: ${session}`, `status: ${status}`, `updated: ${updated}`].filter(Boolean).join(' · ')}`;

/**
 * What other sessions see of a task: header fields, the goal and the item in progress. Never throws.
 * @param {string} text
 * @returns {{ task: string | null, session: string | null, status: string | null, updated: string | null, goal: string | null, inProgress: string | null }}
 */
export function summarizeNotebook(text) {
  const nb = parseNotebook(text);
  const goal = nb.lines.map((l) => /^\*\*Goal:?\*\*:?\s*(.*)$/i.exec(l.trim())?.[1]).find((g) => g);
  return {
    task: nb.header?.task ?? null,
    session: nb.header?.session ?? null,
    status: nb.header?.status ?? null,
    updated: nb.header?.updated ?? null,
    goal: goal ?? null,
    inProgress: nb.items.find((it) => it.marker === '~')?.text ?? null,
  };
}

const DAY = 24 * 60 * 60 * 1000;
const daysBetween = (from, to) => (Date.parse(to) - Date.parse(from)) / DAY;

/**
 * Which notebooks to delete (section 8 of the multi-session proposal), with a fixed margin of `days`:
 * - closed: closed more than `days` ago (its `updated:` date), or its branch is gone;
 * - open: its branch is gone and the notebook has not changed for `days`. An open task of a live branch is never
 *   removed, however old: it is paused work.
 * Undated notebooks (no valid header) are only removed with their branch, after `days` without changes.
 * @param {{ folder: string, status: string | null, updated: string | null, changed: string }[]} notebooks
 *   `folder`: the branch folder name (as `branchFolder` writes it); `changed`: date the file last changed
 * @param {Set<string>} liveFolders branch folder names of the branches that exist
 * @param {string} today YYYY-MM-DD
 * @returns {number[]} indexes of the notebooks to remove
 */
export function cleanupPlan(notebooks, liveFolders, today, days = 7) {
  const out = [];
  notebooks.forEach((nb, i) => {
    const live = liveFolders.has(nb.folder);
    const quiet = daysBetween(nb.changed, today) > days;
    if (nb.status === 'closed') {
      if (!live || (nb.updated && daysBetween(nb.updated, today) > days)) out.push(i);
    } else if (!live && quiet) out.push(i);
  });
  return out;
}
