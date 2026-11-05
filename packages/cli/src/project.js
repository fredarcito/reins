// Reading reins files of a consumer repo, shared by several commands. None of this needs the adapter.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CORE_RULES, ConfigError, parseConfig, parseDoctorConfig, parseNote, isNoteFile, NOTES_DIR } from '@agentreins/core';
import { ARCHITECTURE_FILE, CliError, REINS_DIR } from './context.js';

export const DOCTOR_FILE = `${REINS_DIR}/doctor.yml`;

/** Text of a repo file, or null. */
export const readText = (root, f) => (existsSync(path.join(root, f)) ? readFileSync(path.join(root, f), 'utf8') : null);

/**
 * Domains from architecture.yml without loading the adapter (unknown rule ids are accepted).
 * @param {string} root
 * @param {string[]} notes collects explanations when domains can't be read
 */
export function readDomains(root, notes) {
  const text = readText(root, ARCHITECTURE_FILE);
  if (text === null) {
    notes.push(`${ARCHITECTURE_FILE} not found: domains are unknown.`);
    return [];
  }
  const ids = [...text.matchAll(/\bid:\s*["']?([\w-]+)/g)].map((m) => m[1]);
  try {
    return parseConfig(text, { file: ARCHITECTURE_FILE, knownRules: [...new Set([...CORE_RULES, ...ids])] }).domains;
  } catch {
    notes.push(`${ARCHITECTURE_FILE} is not valid, so domains are unknown (run \`reins check\` to see why).`);
    return [];
  }
}

/** doctor.yml thresholds (defaults when missing). Throws CliError when invalid. */
export function readDoctorConfig(root) {
  try {
    return parseDoctorConfig(readText(root, DOCTOR_FILE), { file: DOCTOR_FILE });
  } catch (e) {
    if (e instanceof ConfigError) throw new CliError(e.message);
    throw e;
  }
}

/**
 * Every module note in .reins/notes/ and its folders (parts of a module: `<module>/<part>.md`), sorted by path.
 * Folders and files starting with "_" or "." are skipped. Deeper folders are read too; doctor flags them.
 * @returns {{ notes: import('@agentreins/core').Note[], problems: string[] }}
 */
export function loadNotes(root) {
  const notes = [];
  const problems = [];
  const visit = (rel) => {
    for (const entry of readdirSync(path.join(root, rel), { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      if (/^[_.]/.test(entry.name)) continue;
      const file = `${rel}/${entry.name}`;
      if (entry.isDirectory()) visit(file);
      else if (isNoteFile(entry.name)) {
        const { note, problem } = parseNote(file, readFileSync(path.join(root, file), 'utf8'));
        if (note) notes.push(note);
        else problems.push(problem);
      }
    }
  };
  if (existsSync(path.join(root, NOTES_DIR))) visit(NOTES_DIR);
  notes.sort((a, b) => (a.file < b.file ? -1 : 1));
  return { notes, problems };
}
