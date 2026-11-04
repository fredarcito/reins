import { cmp, ignoredByKind, isAllowed, render } from '../shared.js';

export const id = 'no-cycles';
export const defaults = {
  message: 'Import cycle: {cycle}.',
  fix: 'Break the cycle: move the code both sides need into a lower module, or invert one of the imports.',
};

/**
 * Strongly connected components (iterative Tarjan, so deep graphs don't overflow the stack).
 * @param {Map<string, string[]>} adj
 * @returns {string[][]}
 */
function scc(adj) {
  let index = 0;
  /** @type {Map<string, number>} */ const idx = new Map();
  /** @type {Map<string, number>} */ const low = new Map();
  const onStack = new Set();
  const stack = [];
  const result = [];
  for (const start of [...adj.keys()].sort(cmp)) {
    if (idx.has(start)) continue;
    /** @type {{ v: string, i: number }[]} */
    const work = [{ v: start, i: 0 }];
    idx.set(start, index);
    low.set(start, index++);
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const next = adj.get(frame.v) ?? [];
      if (frame.i < next.length) {
        const w = next[frame.i++];
        if (!idx.has(w)) {
          idx.set(w, index);
          low.set(w, index++);
          stack.push(w);
          onStack.add(w);
          work.push({ v: w, i: 0 });
        } else if (onStack.has(w)) {
          low.set(frame.v, Math.min(low.get(frame.v), idx.get(w)));
        }
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1].v;
        low.set(parent, Math.min(low.get(parent), low.get(frame.v)));
      }
      if (low.get(frame.v) === idx.get(frame.v)) {
        const comp = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          comp.push(w);
        } while (w !== frame.v);
        result.push(comp);
      }
    }
  }
  return result;
}

/** Shortest cycle through `start` using only nodes of the component. */
function shortestCycle(start, members, adj) {
  const prev = new Map();
  const queue = [start];
  const seen = new Set([start]);
  for (let head = 0; head < queue.length; head++) {
    const v = queue[head];
    for (const w of adj.get(v) ?? []) {
      if (!members.has(w)) continue;
      if (w === start) {
        const back = [v];
        while (back[back.length - 1] !== start) back.push(prev.get(back[back.length - 1]));
        return [...back.reverse(), start];
      }
      if (!seen.has(w)) {
        seen.add(w);
        prev.set(w, v);
        queue.push(w);
      }
    }
  }
  return [start, start];
}

/**
 * Reports each group of files that import each other in a loop (one violation per strongly connected component).
 * Edges covered by `allow` (rule unset or no-cycles) or by ignore_kinds don't count.
 * The baseline key is the sorted member list: if the cycle grows, it counts as new.
 * @param {import('../shared.js').MergedEdge[]} edges
 * @param {import('../../config/index.js').Config} config
 * @returns {import('../shared.js').Violation[]}
 */
export function run(edges, config) {
  const rule = config.rules[id];
  if (!rule || rule.severity === 'off') return [];
  /** @type {Map<string, string[]>} */
  const adj = new Map();
  for (const e of edges) {
    if (ignoredByKind(e, rule) || isAllowed(e, id, config)) continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from).push(e.to);
  }
  for (const list of adj.values()) list.sort(cmp);
  const out = [];
  for (const comp of scc(adj)) {
    const selfLoop = comp.length === 1 && adj.get(comp[0]).includes(comp[0]);
    if (comp.length < 2 && !selfLoop) continue;
    const members = [...comp].sort(cmp);
    const cycle = shortestCycle(members[0], new Set(members), adj);
    const vars = { cycle: cycle.join(' → '), files: members.join(', ') };
    out.push({
      rule: id,
      severity: rule.severity,
      key: `${id}|${members.join('|')}`,
      from: cycle[0],
      to: cycle[1],
      files: members,
      message: render(rule.message ?? defaults.message, vars),
      fix: render(rule.fix ?? defaults.fix, vars),
    });
  }
  return out.sort((a, b) => cmp(a.key, b.key));
}
