// Doctor rules about module notes, the memory of each module between sessions. They only look at the notes of
// the modules this branch touched, and the "keep it up to date" ones only for medium and large diffs: a small
// fix doesn't have to write anything.
import { matchesAny } from '../glob.js';
import { NOTE_TODO_RE } from '../notes/draft.js';
import { NOTES_DIR, parentNoteFile, pathsInside } from '../notes/index.js';
import { isReinsFile } from './triage.js';

const finding = (rule, from, message, fix) => ({ rule, severity: /** @type {const} */ ('warn'), key: `${rule}|${from}`, from, message, fix });

/**
 * note-missing, note-outdated, note-draft, note-size, note-layout; with `repoFiles`, also note-dead-paths and
 * note-dead-refs, for every note (not only the touched ones).
 * @param {object} input
 * @param {string[]} input.changedFiles
 * @param {{ file: string, paths: string[], body: string }[]} input.notes
 * @param {{ name: string, paths: string[] }[]} input.domains
 * @param {'small'|'medium'|'large'} input.level level suggested by the diff
 * @param {number} input.maxLines
 * @param {string[] | null} [input.repoFiles] every file of the repo, repo-relative; null skips the dead-* rules
 * @param {boolean} [input.planChanged] architecture.yml changed: every domain without a note is flagged, at any level
 */
export function checkNotes({ changedFiles, notes, domains, level, maxLines, repoFiles = null, planChanged = false }) {
  const code = changedFiles.filter((f) => !isReinsFile(f));
  const changed = new Set(changedFiles);
  const findings = [];
  const touching = notes.filter((n) => code.some((f) => matchesAny(f, n.paths)) || changed.has(n.file));

  if (level !== 'small') {
    for (const n of touching) {
      if (changed.has(n.file)) continue;
      const files = code.filter((f) => matchesAny(f, n.paths));
      findings.push(
        finding(
          'note-outdated', n.file,
          `${files.length} file(s) of this module changed (${files.slice(0, 3).join(', ')}${files.length > 3 ? ', …' : ''}), but its note did not.`,
          'Before closing, add what the next session needs: decisions taken (with why), traps found, and Map or "How it works" if they changed. If nothing durable changed, ignore this warning.',
        ),
      );
    }
    for (const d of domains) {
      const files = code.filter((f) => matchesAny(f, d.paths));
      if (!files.length || files.some((f) => notes.some((n) => matchesAny(f, n.paths)))) continue;
      findings.push(
        finding(
          'note-missing', d.name,
          `Domain ${d.name} changed (${files.length} file(s)) and has no module note, so the next session will have to rediscover it from the code.`,
          `Create one: \`npx reins notes new ${d.name}\`, then fill in Purpose, How it works, Decisions and Traps.`,
        ),
      );
    }
  }
  // a domain added to (or redrawn in) the plan has no changed code yet, but it is a module without a note all the same
  if (planChanged) {
    const flagged = new Set(findings.filter((f) => f.rule === 'note-missing').map((f) => f.from));
    const prefix = (glob) => glob.replace(/\*\*$/, '');
    for (const d of domains) {
      if (flagged.has(d.name)) continue;
      const own = repoFiles?.filter((f) => matchesAny(f, d.paths));
      const covered = own?.length
        ? own.some((f) => notes.some((n) => matchesAny(f, n.paths)))
        : notes.some((n) => n.paths.some((p) => d.paths.some((dp) => p.startsWith(prefix(dp)) || dp.startsWith(prefix(p)))));
      if (covered) continue;
      findings.push(
        finding(
          'note-missing', d.name,
          `Domain ${d.name} is in architecture.yml but has no module note, so the next session will have to rediscover it from the code.`,
          `Draft one from the code: \`npx reins notes new ${d.name}\`, then fill in Purpose, How it works, Decisions and Traps (in Claude Code: /reins-notes).`,
        ),
      );
    }
  }

  const drafts = touching.filter((n) => NOTE_TODO_RE.test(n.body));
  findings.push(...draftFindings(drafts));
  for (const n of touching) {
    findings.push(...checkLayout(n, notes));
    const lines = n.body.split('\n').length;
    if (lines > maxLines) {
      findings.push(
        finding(
          'note-size', n.file,
          `The note has ${lines} lines; the limit is ${maxLines}. It is read every time an agent works on this module.`,
          'Keep what a newcomer needs to work here safely; remove what the code already says and decisions that no longer apply.',
        ),
      );
    }
  }
  if (repoFiles) findings.push(...checkDead(notes, repoFiles));
  return findings;
}

/**
 * One warning per note, or a single one for all of them when there are several: a long list of the same
 * warning buries the ones that matter.
 * @param {string} rule
 * @param {{ file: string, detail: string }[]} items
 * @param {(item: { file: string, detail: string }) => string} one message for a single note
 * @param {(count: number, list: string) => string} many message for several notes
 * @param {string} fix
 */
function grouped(rule, items, one, many, fix) {
  if (items.length === 0) return [];
  if (items.length === 1) return [finding(rule, items[0].file, one(items[0]), fix)];
  const shown = items.slice(0, MAX_DRAFTS_NAMED).map((i) => `${noteName(i.file)}: ${i.detail}`);
  const more = items.length > MAX_DRAFTS_NAMED ? `; +${items.length - MAX_DRAFTS_NAMED} more` : '';
  return [finding(rule, `${NOTES_DIR}/`, many(items.length, `${shown.join('; ')}${more}`), fix)];
}

const noteName = (file) => file.slice(NOTES_DIR.length + 1, -3);
const GLOB_CHARS = /[*?{}<>]/;
// a repo path written in backticks: segments without spaces, an optional trailing "/" or ":<line>"
const REF_RE = /`([^`\s]+)`/g;
const PATH_RE = /^[\w.@()[\]$+-]+(\/[\w.@()[\]$+-]+)+\/?$/;

/**
 * Backticked repo paths in a note body that point nowhere. Only paths whose first folder exists at the repo
 * root count, so package names (`@scope/pkg`), module ids (`node:fs`) and relative examples are left alone.
 * @param {string} body
 * @param {Set<string>} files
 * @param {Set<string>} dirs every folder of the repo
 * @param {Set<string>} top first segment of every repo file
 */
export function deadRefs(body, files, dirs, top) {
  const dead = new Set();
  for (const [, raw] of body.matchAll(REF_RE)) {
    const ref = raw.replace(/:\d+(-\d+)?$/, '');
    if (GLOB_CHARS.test(ref) || !PATH_RE.test(ref) || !top.has(ref.split('/')[0])) continue;
    const clean = ref.replace(/\/$/, '');
    if (!files.has(clean) && !dirs.has(clean)) dead.add(ref);
  }
  return [...dead];
}

/** note-dead-paths and note-dead-refs over every note. */
function checkDead(notes, repoFiles) {
  const files = new Set(repoFiles);
  const dirs = new Set();
  for (const f of repoFiles) for (let i = f.indexOf('/'); i !== -1; i = f.indexOf('/', i + 1)) dirs.add(f.slice(0, i));
  const top = new Set(repoFiles.map((f) => f.split('/')[0]));

  const deadPaths = [];
  const deadRefList = [];
  for (const n of notes) {
    const unmatched = n.paths.filter((g) => !repoFiles.some((f) => matchesAny(f, [g])));
    if (unmatched.length) deadPaths.push({ file: n.file, detail: unmatched.join(', '), all: unmatched.length === n.paths.length });
    const refs = deadRefs(n.body, files, dirs, top);
    if (refs.length) deadRefList.push({ file: n.file, detail: refs.slice(0, 3).join(', ') + (refs.length > 3 ? `, +${refs.length - 3} more` : '') });
  }
  return [
    ...grouped(
      'note-dead-paths', deadPaths,
      (i) => `${i.all ? 'None of its paths match' : 'Some of its paths match'} a file of the repo (${i.detail})${i.all ? ', so the note reaches nobody: not the hook, not `reins notes <path>`.' : '.'}`,
      (count, list) => `${count} notes have paths that match no file of the repo (${list}). A note whose paths match nothing reaches nobody.`,
      'The module was probably moved or renamed: update `paths` in the frontmatter, or delete the note if the module is gone. Then run `npx reins sync`.',
    ),
    ...grouped(
      'note-dead-refs', deadRefList,
      (i) => `It names files or folders that no longer exist (${i.detail}).`,
      (count, list) => `${count} notes name files or folders that no longer exist (${list}).`,
      'Fix the names (in Claude Code: /reins-notes review), or remove the lines if what they described is gone.',
    ),
  ];
}

const DRAFT_FIX = 'Ask your agent to fill it in (in Claude Code: /reins-notes), or replace each TODO yourself; delete a TODO line if there is nothing true to say.';
/** Draft notes named in the grouped note-draft warning. */
const MAX_DRAFTS_NAMED = 5;

/**
 * note-draft. Drafts are templates nobody has filled in yet (`init` writes one per module), not debt: one warning
 * for all of them, so dozens of fresh drafts don't bury the warnings that matter.
 * @param {{ file: string }[]} drafts
 */
function draftFindings(drafts) {
  if (drafts.length === 0) return [];
  if (drafts.length === 1) return [finding('note-draft', drafts[0].file, 'The note still has TODO lines from its draft.', DRAFT_FIX)];
  const names = drafts.slice(0, MAX_DRAFTS_NAMED).map((n) => n.file.slice(NOTES_DIR.length + 1, -3));
  const more = drafts.length > MAX_DRAFTS_NAMED ? `, +${drafts.length - MAX_DRAFTS_NAMED} more` : '';
  return [
    finding(
      'note-draft', `${NOTES_DIR}/`,
      `${drafts.length} notes are still drafts with TODO lines (${names.join(', ')}${more}): templates waiting to be filled in, not problems in the code.`,
      'Ask your agent to fill them in (in Claude Code: /reins-notes), one module at a time if you prefer; delete a TODO line if there is nothing true to say.',
    ),
  ];
}

/**
 * note-layout: parts of a module live one folder deep, next to the module's note, and inside its folders.
 * @param {{ file: string, paths: string[] }} n
 * @param {{ file: string, paths: string[] }[]} notes
 */
function checkLayout(n, notes) {
  const depth = n.file.slice(NOTES_DIR.length + 1).split('/').length - 1;
  if (depth > 1) {
    return [finding('note-layout', n.file, 'Notes go at most one folder deep: `.reins/notes/<module>.md` and `.reins/notes/<module>/<part>.md`.', 'Move it to the folder of the module it belongs to, or to the top level if it is a module of its own.')];
  }
  const parentFile = parentNoteFile(n.file);
  if (!parentFile) return [];
  const parent = notes.find((x) => x.file === parentFile);
  if (!parent) {
    return [finding('note-layout', n.file, `It sits in a module folder, but ${parentFile} does not exist, so nothing gives the shared context of this part.`, `Create ${parentFile} (\`npx reins notes new <domain|folder>\`), or move this note to the top level if it is a module of its own.`)];
  }
  if (!pathsInside(n, parent)) {
    return [finding('note-layout', n.file, `Its paths (${n.paths.join(', ')}) are not inside the folders of ${parentFile}, so it is not a part of that module.`, `Fix its paths, add the folder to ${parentFile}, or move the note to the top level.`)];
  }
  return [];
}
