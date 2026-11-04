// Doctor rules about module notes, the memory of each module between sessions. They only look at the notes of
// the modules this branch touched, and the "keep it up to date" ones only for medium and large diffs: a small
// fix doesn't have to write anything.
import { matchesAny } from '../glob.js';
import { NOTE_TODO_RE } from '../notes/draft.js';
import { isReinsFile } from './triage.js';

const finding = (rule, from, message, fix) => ({ rule, severity: /** @type {const} */ ('warn'), key: `${rule}|${from}`, from, message, fix });

/**
 * note-missing, note-outdated, note-draft, note-size.
 * @param {object} input
 * @param {string[]} input.changedFiles
 * @param {{ file: string, paths: string[], body: string }[]} input.notes
 * @param {{ name: string, paths: string[] }[]} input.domains
 * @param {'small'|'medium'|'large'} input.level level suggested by the diff
 * @param {number} input.maxLines
 */
export function checkNotes({ changedFiles, notes, domains, level, maxLines }) {
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

  for (const n of touching) {
    if (NOTE_TODO_RE.test(n.body)) {
      findings.push(finding('note-draft', n.file, 'The note still has TODO lines from its draft.', 'Ask your agent to fill it in (in Claude Code: /reins-notes), or replace each TODO yourself; delete a TODO line if there is nothing true to say.'));
    }
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
  return findings;
}
