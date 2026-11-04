// Reads and validates architecture.yml. Collects every problem instead of stopping at the first one,
// and points at the exact field ("layers[1].paths") so a person or an agent can fix it in one pass.
import { readFile } from 'node:fs/promises';
import { parseDocument } from 'yaml';

export const CONFIG_VERSION = 1;

/** Rules implemented by the core. Adapters can add more (see Adapter.rules in the contract). */
export const CORE_RULES = Object.freeze(['layer-direction', 'domain-boundary', 'no-cycles', 'integrity']);
export const SEVERITIES = Object.freeze(['error', 'warn', 'off']);

/** Severity of each core rule when architecture.yml has no `rules:` section, or doesn't list the rule. */
const DEFAULT_SEVERITY_WHEN_NO_RULES = { 'layer-direction': 'error', 'domain-boundary': 'error', 'no-cycles': 'error', integrity: 'warn' };
/** `integrity` is on unless turned off explicitly; the other rules must be listed. */
const DEFAULT_SEVERITY_WHEN_UNLISTED = { integrity: 'warn' };

const TOP_KEYS = ['version', 'adapter', 'preset', 'ignore', 'layers', 'domains', 'rules', 'allow'];
const RULE_KEYS = ['id', 'severity', 'message', 'fix', 'ignore_kinds', 'options'];

/**
 * @typedef {{ name: string, paths: string[] }} Layer
 * @typedef {{ name: string, paths: string[], publicApi: string[] }} Domain
 * @typedef {{ id: string, severity: 'error'|'warn'|'off', message?: string, fix?: string, ignoreKinds: string[], options: object }} RuleConfig
 * @typedef {{ from: string, to: string, reason: string, rule?: string }} Allow
 * @typedef {object} Config
 * @property {number} version
 * @property {string} adapter
 * @property {string} [preset]
 * @property {string[]} ignore  globs of files left out of the analysis (generated code, fixtures…)
 * @property {Layer[]} layers   ordered from top (may import anything below) to bottom
 * @property {Domain[]} domains
 * @property {Record<string, RuleConfig>} rules
 * @property {Allow[]} allow
 */

export class ConfigError extends Error {
  /** @param {string} file @param {string[]} problems */
  constructor(file, problems) {
    super(`${file} is not valid:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
    this.file = file;
    this.problems = problems;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStrList = (v) => Array.isArray(v) && v.length > 0 && v.every((s) => typeof s === 'string' && s.length > 0);

/**
 * Validates an already parsed architecture.yml.
 * @param {unknown} raw
 * @param {{ knownRules?: readonly string[] }} [opts] knownRules: core rules plus the adapter's rules
 * @returns {{ config: Config | null, problems: string[] }}
 */
export function validateConfig(raw, opts = {}) {
  const knownRules = opts.knownRules ?? CORE_RULES;
  const problems = [];
  const p = (msg) => problems.push(msg);
  if (!isObj(raw)) return { config: null, problems: ['the file must be a YAML mapping (key: value)'] };

  for (const k of Object.keys(raw)) if (!TOP_KEYS.includes(k)) p(`${k}: unknown key (expected one of: ${TOP_KEYS.join(', ')})`);

  if (raw.version !== CONFIG_VERSION) p(`version: expected ${CONFIG_VERSION}, got ${JSON.stringify(raw.version)}`);
  if (typeof raw.adapter !== 'string' || !raw.adapter) p('adapter: required, e.g. "adapter: js"');
  if (raw.preset !== undefined && (typeof raw.preset !== 'string' || !raw.preset)) p('preset: must be a string');
  if (raw.ignore !== undefined && !isStrList(raw.ignore)) p('ignore: expected a non-empty list of globs, e.g. ["src/generated/**"]');

  /** @type {Layer[]} */
  const layers = [];
  if (raw.layers !== undefined) {
    if (!Array.isArray(raw.layers)) p('layers: must be a list, ordered from the top layer to the bottom one');
    else {
      const names = new Set();
      raw.layers.forEach((l, i) => {
        if (!isObj(l)) return p(`layers[${i}]: expected { name, paths }`);
        if (typeof l.name !== 'string' || !l.name) p(`layers[${i}].name: required`);
        else if (names.has(l.name)) p(`layers[${i}].name: duplicate layer "${l.name}"`);
        names.add(l.name);
        if (!isStrList(l.paths)) p(`layers[${i}].paths: expected a non-empty list of globs`);
        for (const k of Object.keys(l)) if (!['name', 'paths'].includes(k)) p(`layers[${i}].${k}: unknown key`);
        if (typeof l.name === 'string' && isStrList(l.paths)) layers.push({ name: l.name, paths: l.paths });
      });
    }
  }

  /** @type {Domain[]} */
  const domains = [];
  if (raw.domains !== undefined) {
    if (!isObj(raw.domains)) p('domains: must be a mapping of domain name to { paths, public_api }');
    else {
      for (const [name, d] of Object.entries(raw.domains)) {
        if (!isObj(d)) {
          p(`domains.${name}: expected { paths, public_api }`);
          continue;
        }
        if (!isStrList(d.paths)) p(`domains.${name}.paths: expected a non-empty list of globs`);
        if (!isStrList(d.public_api)) p(`domains.${name}.public_api: expected a non-empty list of files or globs (e.g. the domain's index.js)`);
        for (const k of Object.keys(d)) if (!['paths', 'public_api'].includes(k)) p(`domains.${name}.${k}: unknown key`);
        if (isStrList(d.paths) && isStrList(d.public_api)) domains.push({ name, paths: d.paths, publicApi: d.public_api });
      }
    }
  }

  /** @type {Record<string, RuleConfig>} */
  const rules = {};
  const mkRule = (id, severity) => ({ id, severity, ignoreKinds: [], options: {} });
  if (raw.rules === undefined) {
    for (const [id, sev] of Object.entries(DEFAULT_SEVERITY_WHEN_NO_RULES)) rules[id] = mkRule(id, sev);
  } else if (!Array.isArray(raw.rules)) {
    p('rules: must be a list of { id, severity }');
  } else {
    raw.rules.forEach((r, i) => {
      if (!isObj(r)) return p(`rules[${i}]: expected { id, severity }`);
      const where = typeof r.id === 'string' ? `rules[${i}] (${r.id})` : `rules[${i}]`;
      if (typeof r.id !== 'string' || !knownRules.includes(r.id)) {
        return p(`${where}.id: unknown rule ${JSON.stringify(r.id)} (known: ${knownRules.join(', ')})`);
      }
      if (rules[r.id]) return p(`${where}: rule listed twice`);
      if (!SEVERITIES.includes(r.severity)) p(`${where}.severity: expected one of ${SEVERITIES.join(', ')}`);
      for (const k of ['message', 'fix']) if (r[k] !== undefined && typeof r[k] !== 'string') p(`${where}.${k}: must be a string`);
      if (r.ignore_kinds !== undefined && !isStrList(r.ignore_kinds)) p(`${where}.ignore_kinds: expected a list of edge kinds, e.g. [type]`);
      if (r.options !== undefined && !isObj(r.options)) p(`${where}.options: must be a mapping`);
      for (const k of Object.keys(r)) if (!RULE_KEYS.includes(k)) p(`${where}.${k}: unknown key (expected: ${RULE_KEYS.join(', ')})`);
      rules[r.id] = {
        id: r.id,
        severity: SEVERITIES.includes(r.severity) ? r.severity : 'error',
        message: typeof r.message === 'string' ? r.message : undefined,
        fix: typeof r.fix === 'string' ? r.fix : undefined,
        ignoreKinds: isStrList(r.ignore_kinds) ? r.ignore_kinds : [],
        options: isObj(r.options) ? r.options : {},
      };
    });
    for (const [id, sev] of Object.entries(DEFAULT_SEVERITY_WHEN_UNLISTED)) if (!rules[id]) rules[id] = mkRule(id, sev);
  }

  /** @type {Allow[]} */
  const allow = [];
  if (raw.allow !== undefined) {
    if (!Array.isArray(raw.allow)) p('allow: must be a list of { from, to, reason }');
    else {
      raw.allow.forEach((a, i) => {
        if (!isObj(a)) return p(`allow[${i}]: expected { from, to, reason }`);
        for (const k of ['from', 'to']) if (typeof a[k] !== 'string' || !a[k]) p(`allow[${i}].${k}: required glob`);
        if (typeof a.reason !== 'string' || a.reason.trim().length < 3) p(`allow[${i}].reason: required; say why this exception is acceptable`);
        if (a.rule !== undefined && !knownRules.includes(a.rule)) p(`allow[${i}].rule: unknown rule ${JSON.stringify(a.rule)}`);
        for (const k of Object.keys(a)) if (!['from', 'to', 'reason', 'rule'].includes(k)) p(`allow[${i}].${k}: unknown key`);
        if (typeof a.from === 'string' && typeof a.to === 'string' && typeof a.reason === 'string') {
          allow.push({ from: a.from, to: a.to, reason: a.reason, ...(a.rule ? { rule: a.rule } : {}) });
        }
      });
    }
  }

  if (problems.length) return { config: null, problems };
  return {
    config: { version: raw.version, adapter: raw.adapter, ...(raw.preset ? { preset: raw.preset } : {}), ignore: isStrList(raw.ignore) ? raw.ignore : [], layers, domains, rules, allow },
    problems,
  };
}

/**
 * Parses and validates architecture.yml text. Throws ConfigError with every problem found.
 * @param {string} text
 * @param {{ file?: string, knownRules?: readonly string[] }} [opts]
 * @returns {Config}
 */
export function parseConfig(text, opts = {}) {
  const file = opts.file ?? 'architecture.yml';
  const doc = parseDocument(text, { prettyErrors: true });
  if (doc.errors.length) {
    throw new ConfigError(file, doc.errors.map((e) => `YAML syntax: ${e.message.split('\n')[0]}`));
  }
  const { config, problems } = validateConfig(doc.toJS(), opts);
  if (!config) throw new ConfigError(file, problems);
  return config;
}

/**
 * @param {string} path path to architecture.yml
 * @param {{ knownRules?: readonly string[] }} [opts]
 * @returns {Promise<Config>}
 */
export async function loadConfig(path, opts = {}) {
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') {
      throw new ConfigError(path, ['file not found. Run `reins init` to draft one.']);
    }
    throw e;
  }
  return parseConfig(text, { ...opts, file: path });
}
