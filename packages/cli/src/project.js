// Reading reins files of a consumer repo, shared by several commands. None of this needs the adapter.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { CORE_RULES, ConfigError, parseConfig, parseDoctorConfig, parseNote, isNoteFile, NOTES_DIR } from '@reins/core';
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
 * Every module note in .reins/notes/, sorted by file name.
 * @returns {{ notes: import('@reins/core').Note[], problems: string[] }}
 */
export function loadNotes(root) {
  const dir = path.join(root, NOTES_DIR);
  const notes = [];
  const problems = [];
  if (!existsSync(dir)) return { notes, problems };
  for (const name of readdirSync(dir).filter(isNoteFile).sort()) {
    const file = `${NOTES_DIR}/${name}`;
    const { note, problem } = parseNote(file, readFileSync(path.join(dir, name), 'utf8'));
    if (note) notes.push(note);
    else problems.push(problem);
  }
  return { notes, problems };
}
