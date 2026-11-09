// Public entry point of @agentreins/core. Framework-agnostic: it only knows edges, globs, YAML and git.
export { CONTRACT_VERSION, EDGE_KINDS, validateAdapter, validateEdges, normalizeGraph } from './contract/index.js';
export { CONFIG_VERSION, CORE_RULES, SEVERITIES, ConfigError, validateConfig, parseConfig, loadConfig, adapterNamesOf } from './config/index.js';
export { RULES, evaluate, runCheck } from './check/index.js';
export { BASELINE_VERSION, createBaseline, serializeBaseline, parseBaseline, emptyBaseline } from './check/baseline.js';
export { compareIntegrity, checkIntegrity } from './check/integrity.js';
export { REPORT_SCHEMA, formatText, formatJson } from './report/index.js';
export { globToRegExp, matchesAny } from './glob.js';
export { impactOf } from './impact/index.js';
export {
  DOCTOR_RULES, runDoctor, parseDoctorConfig, DOCTOR_DEFAULTS, LEVELS, parseTriageLog, formatTriageLine, taskAnchor, scopeSignals, suggestLevel,
  parseNotebook, formatProblems, notebookFile, taskFolder, branchFolder, PROGRESS_DIR, NOTEBOOK_NAME, TASK_RE, formatHeader, summarizeNotebook,
  cleanupPlan, MARKERS, countLines,
} from './doctor/index.js';
export { NOTES_DIR, parseNote, parseFrontmatter, isNoteFile, notesFor, parentNoteFile, pathsInside } from './notes/index.js';
export { NOTE_TODO_RE, summarizeModule, draftNote } from './notes/draft.js';
export { rankStaleNotes } from './notes/stale.js';
export { BACKLOG_FILE, BACKLOG_HEADER, STATUSES, parseBacklog, renderFinding, addFinding, setStatus, markRecheck } from './backlog/index.js';
export { NotebookError, SECTIONS, listItems, markDone, markStarted, markDropped, addItem, setNext, newNotebook, setHeader } from './doctor/progress-edit.js';
export { prStructure, nodeResolver, staticPrefix } from './prmap/index.js';
export { renderPrMap, MAP_EDGE_LIMIT, MAX_COMMENT_CHARS, MARKER as PR_MAP_MARKER } from './prmap/render.js';
