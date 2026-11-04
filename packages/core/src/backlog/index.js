// Audit backlog: .harness/backlog/optimizations.md (local, outside git). One finding per line, so audits
// don't start from zero and discarded ideas aren't proposed again:
//
//   - [open] A1 · 2026-11-04 · `src/features/cart/` · Memoize the cart totals.
//   - [open] [recheck] A2 · 2026-11-04 · `src/lib/format.js` · Cache Intl.NumberFormat.
//   - [done] A3 · 2026-11-04 · `src/app/page.tsx` · Lazy-load the chart. — done 2026-11-06: moved to dynamic import
//   - [wontfix] A4 · 2026-11-04 · `src/api/` · Batch requests. — wontfix 2026-11-06: the API has no batch endpoint
//
// Edits are line-based: lines that are not findings (headings, notes) are kept as they are.

export const BACKLOG_FILE = '.harness/backlog/optimizations.md';
export const STATUSES = Object.freeze(['open', 'done', 'wontfix']);

const ITEM_RE = /^- \[(\w+)\]( \[recheck\])? (A\d+) · (\d{4}-\d{2}-\d{2}) · `([^`]*)` · (.+?)(?: — (open|done|wontfix) (\d{4}-\d{2}-\d{2}): (.+))?$/;
const LOOKS_LIKE_ITEM = /^- \[/;

export const BACKLOG_HEADER = `# Optimization backlog

<!-- Managed by \`harness audit\` (local, outside git). Format: - [open|done|wontfix] [recheck]? A<n> · date · \`path\` · finding — status date: reason -->
`;

/**
 * @typedef {{ line: number, status: string, recheck: boolean, id: string, date: string, path: string, finding: string,
 *   resolution: { status: string, date: string, reason: string } | null }} Finding
 */

/** @param {string} text @returns {{ items: Finding[], problems: string[], lines: string[] }} */
export function parseBacklog(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const items = [];
  const problems = [];
  const ids = new Set();
  lines.forEach((raw, i) => {
    if (!LOOKS_LIKE_ITEM.test(raw)) return;
    const m = ITEM_RE.exec(raw);
    if (!m || !STATUSES.includes(m[1])) {
      problems.push(`line ${i + 1} is not a valid finding: "${raw}"`);
      return;
    }
    if (ids.has(m[3])) problems.push(`line ${i + 1}: duplicate id ${m[3]}`);
    ids.add(m[3]);
    if (m[1] !== 'open' && !m[7]) problems.push(`line ${i + 1}: ${m[1]} without a reason (— ${m[1]} YYYY-MM-DD: reason)`);
    items.push({
      line: i + 1, status: m[1], recheck: Boolean(m[2]), id: m[3], date: m[4], path: m[5], finding: m[6],
      resolution: m[7] ? { status: m[7], date: m[8], reason: m[9] } : null,
    });
  });
  return { items, problems, lines };
}

/** @param {Finding} f */
export function renderFinding(f) {
  const res = f.resolution ? ` — ${f.resolution.status} ${f.resolution.date}: ${f.resolution.reason}` : '';
  return `- [${f.status}]${f.recheck ? ' [recheck]' : ''} ${f.id} · ${f.date} · \`${f.path}\` · ${f.finding}${res}`;
}

const oneLine = (s, what) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) throw new Error(`${what} can't be empty.`);
  if (t.includes('`')) throw new Error(`${what} can't contain backticks.`);
  return t;
};

/** Throws if the backlog is not valid, so edits never build on a broken file. */
function parseValid(text) {
  const parsed = parseBacklog(text);
  if (parsed.problems.length) throw new Error(`${BACKLOG_FILE} has format problems; fix them first:\n${parsed.problems.map((p) => `  - ${p}`).join('\n')}`);
  return parsed;
}

/** Re-parses an edited backlog and fails loudly if an edit produced an invalid file (should never happen). */
function checked(text) {
  parseValid(text);
  return text;
}

/**
 * Adds an open finding. Refuses an exact duplicate (same path and text) of any existing finding, including wontfix ones.
 * @param {string | null} text current file, or null when it doesn't exist yet
 * @returns {{ text: string, id: string }}
 */
export function addFinding(text, { path, finding, date }) {
  const base = text ?? BACKLOG_HEADER;
  const { items, lines } = parseValid(base);
  const p = oneLine(path, 'The path');
  const f = oneLine(finding, 'The finding');
  const dup = items.find((it) => it.path === p && it.finding.toLowerCase() === f.toLowerCase());
  if (dup) throw new Error(`Already recorded as ${dup.id} (${dup.status}${dup.resolution ? `: ${dup.resolution.reason}` : ''}).`);
  const id = `A${items.reduce((max, it) => Math.max(max, Number(it.id.slice(1))), 0) + 1}`;
  const item = renderFinding({ status: 'open', recheck: false, id, date, path: p, finding: f, resolution: null });
  const body = lines.join('\n').replace(/\n*$/, '');
  return { text: checked(`${body}\n${items.length ? '' : '\n'}${item}\n`), id };
}

/**
 * Changes the status of a finding. done and wontfix need a reason; reopening keeps the history in the reason.
 * Clears the recheck flag.
 */
export function setStatus(text, { id, status, reason, date }) {
  if (!STATUSES.includes(status)) throw new Error(`Status must be one of ${STATUSES.join(', ')}.`);
  const { items, lines } = parseValid(text);
  const item = items.find((it) => it.id === id);
  if (!item) throw new Error(`No finding ${id}.`);
  const why = status === 'open' && !reason ? null : oneLine(reason, `The reason for ${status}`);
  const updated = { ...item, status, recheck: false, resolution: why ? { status, date, reason: why } : null };
  lines[item.line - 1] = renderFinding(updated);
  return checked(lines.join('\n'));
}

/**
 * Flags findings to be verified again against the current code. `ids` = list of ids, or "open" for every open one.
 * @returns {{ text: string, marked: string[] }}
 */
export function markRecheck(text, ids) {
  const { items, lines } = parseValid(text);
  const targets = ids === 'open' ? items.filter((it) => it.status === 'open') : ids.map((id) => {
    const it = items.find((x) => x.id === id);
    if (!it) throw new Error(`No finding ${id}.`);
    return it;
  });
  for (const it of targets) lines[it.line - 1] = renderFinding({ ...it, recheck: true });
  return { text: checked(lines.join('\n')), marked: targets.map((t) => t.id) };
}
