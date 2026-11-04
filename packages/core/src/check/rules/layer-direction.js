import { classifier, ignoredByKind, isAllowed, render } from '../shared.js';

export const id = 'layer-direction';
export const defaults = {
  message: '{from} ({from_layer}) imports {to} ({to_layer}), but {to_layer} is above {from_layer}.',
  fix: 'Move what {from} needs from {to_layer} down to {from_layer} or a lower layer, or invert the dependency (pass it in as props or callbacks).',
};

/**
 * A layer may only import from itself or from layers below it. Files outside every layer are ignored.
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
    const fi = cls.layerIndex(e.from);
    const ti = cls.layerIndex(e.to);
    if (fi === -1 || ti === -1 || ti >= fi) continue;
    if (ignoredByKind(e, rule) || isAllowed(e, id, config)) continue;
    const vars = { from: e.from, to: e.to, from_layer: config.layers[fi].name, to_layer: config.layers[ti].name };
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
