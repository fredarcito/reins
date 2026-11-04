import { matchesAny } from '../../glob.js';
import { classifier, ignoredByKind, isAllowed, render } from '../shared.js';

export const id = 'domain-boundary';
export const defaults = {
  message: '{from} imports {to}, an internal file of the {domain} domain.',
  fix: 'Import from the public API of {domain} instead: {public_api}. If something is missing there, export it from that file.',
};

/**
 * Code outside a domain may only import the domain's public API. Files inside the same domain import freely.
 * @param {import('../shared.js').MergedEdge[]} edges
 * @param {import('../../config/index.js').Config} config
 * @returns {import('../shared.js').Violation[]}
 */
export function run(edges, config) {
  const rule = config.rules[id];
  if (!rule || rule.severity === 'off') return [];
  const cls = classifier(config);
  const out = [];
  for (const e of edges) {
    const target = cls.domain(e.to);
    if (!target || cls.domain(e.from) === target) continue;
    if (matchesAny(e.to, target.publicApi)) continue;
    if (ignoredByKind(e, rule) || isAllowed(e, id, config)) continue;
    const vars = { from: e.from, to: e.to, domain: target.name, public_api: target.publicApi.join(', ') };
    out.push({
      rule: id,
      severity: rule.severity,
      key: `${id}|${e.from}|${e.to}`,
      from: e.from,
      to: e.to,
      message: render(rule.message ?? defaults.message, vars),
      fix: render(rule.fix ?? defaults.fix, vars),
    });
  }
  return out;
}
