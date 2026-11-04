// Public entry point of @reins/core. Framework-agnostic: it only knows edges, globs, YAML and git.
export { CONTRACT_VERSION, EDGE_KINDS, validateAdapter, validateEdges, normalizeGraph } from './contract/index.js';
export { CONFIG_VERSION, CORE_RULES, SEVERITIES, ConfigError, validateConfig, parseConfig, loadConfig } from './config/index.js';
export { RULES, evaluate, runCheck } from './check/index.js';
export { BASELINE_VERSION, createBaseline, serializeBaseline, parseBaseline, emptyBaseline } from './check/baseline.js';
export { compareIntegrity, checkIntegrity } from './check/integrity.js';
export { REPORT_SCHEMA, formatText, formatJson } from './report/index.js';
export { globToRegExp, matchesAny } from './glob.js';
export {
  DOCTOR_RULES, runDoctor, parseDoctorConfig, DOCTOR_DEFAULTS, LEVELS, parseTriageLog, scopeSignals, suggestLevel,
  parseNotebook, formatProblems, notebookFile, MARKERS,
} from './doctor/index.js';
export { NOTES_DIR, parseNote, parseFrontmatter, isNoteFile, notesFor } from './notes/index.js';
export { NOTE_TODO_RE, summarizeModule, draftNote } from './notes/draft.js';
export { BACKLOG_FILE, BACKLOG_HEADER, STATUSES, parseBacklog, renderFinding, addFinding, setStatus, markRecheck } from './backlog/index.js';
export { NotebookError, SECTIONS, listItems, markDone, markStarted, markDropped, addItem, setNext, newNotebook } from './doctor/progress-edit.js';
