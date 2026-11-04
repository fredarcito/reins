// Public entry point of @harness/core. Framework-agnostic: it only knows edges, globs, YAML and git.
export { CONTRACT_VERSION, EDGE_KINDS, validateAdapter, validateEdges } from './contract/index.js';
export { CONFIG_VERSION, CORE_RULES, SEVERITIES, ConfigError, validateConfig, parseConfig, loadConfig } from './config/index.js';
export { RULES, evaluate, runCheck } from './check/index.js';
export { BASELINE_VERSION, createBaseline, serializeBaseline, parseBaseline, emptyBaseline } from './check/baseline.js';
export { compareIntegrity, checkIntegrity } from './check/integrity.js';
export { REPORT_SCHEMA, formatText, formatJson } from './report/index.js';
export { globToRegExp, matchesAny } from './glob.js';
