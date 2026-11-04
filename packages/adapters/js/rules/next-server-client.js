// Optional Next.js rule: a client component ('use client') must not pull server-only code into the client bundle.
// Everything a client component imports (transitively) ships to the browser, so reaching a module that imports
// `server-only` or `next/headers` is a leak (or a build error waiting to happen).
//
// Enable it in architecture.yml:  - { id: next-server-client, severity: error }
import { readFileSync } from 'node:fs';
import path from 'node:path';

export const id = 'next-server-client';

const DEFAULTS = {
  message: "{from} is a client component ('use client') but reaches {to}, which is server-only ({reason}): {chain}.",
  fix: 'Keep server-only code out of the client bundle: load the data in a server component and pass it as props, or move the call into a server action (\'use server\').',
};

/** Server-only markers: modules that must never reach the browser. */
const SERVER_ONLY_IMPORTS = ['server-only', 'next/headers'];

/** True if the first statement of the file is the 'use client' directive (comments allowed before it). */
export function isClientComponent(source) {
  const body = source.replace(/^﻿/, '').replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, '');
  return /^(['"])use client\1/.test(body);
}

/** The server-only module a file imports, if any. */
export function serverOnlyImport(source) {
  for (const mod of SERVER_ONLY_IMPORTS) {
    const re = new RegExp(`(?:from\\s*|import\\s*\\(?\\s*|require\\(\\s*)(['"])${mod.replace('/', '\\/')}\\1`);
    if (re.test(source)) return mod;
  }
  return null;
}

const render = (t, vars) => t.replace(/\{([a-z_]+)\}/g, (m, k) => (k in vars ? vars[k] : m));

/**
 * @param {string} repoPath
 * @param {{ rules: Record<string, { severity: string, message?: string, fix?: string }> }} config parsed architecture.yml
 * @param {{ edges: import('@agentreins/core/contract').Edge[], files?: string[] }} graph normalized graph
 * @returns {import('@agentreins/core/contract').AdapterViolation[]}
 */
export function run(repoPath, config, graph) {
  const rule = config.rules?.[id];
  if (!rule || rule.severity === 'off') return [];

  const { edges } = graph;
  const files = new Set([...(graph.files ?? []), ...edges.flatMap((e) => [e.from, e.to])]);
  /** @type {Map<string, string>} */
  const text = new Map();
  const read = (f) => {
    if (!text.has(f)) {
      try {
        text.set(f, readFileSync(path.join(repoPath, f), 'utf8'));
      } catch {
        text.set(f, '');
      }
    }
    return text.get(f);
  };

  /** @type {Map<string, string[]>} runtime imports only: type-only imports don't ship to the browser */
  const adj = new Map();
  for (const e of edges) {
    if (e.kind === 'type') continue;
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from).push(e.to);
  }

  const out = [];
  for (const client of [...files].sort()) {
    if (!/\.(js|jsx|ts|tsx|mjs)$/.test(client) || !isClientComponent(read(client))) continue;
    // BFS from the client component; report the nearest server-only module on each path.
    const prev = new Map([[client, null]]);
    const queue = [client];
    for (let head = 0; head < queue.length; head++) {
      const f = queue[head];
      const reason = serverOnlyImport(read(f));
      if (reason) {
        const chain = [];
        for (let n = f; n !== null; n = prev.get(n)) chain.unshift(n);
        const vars = { from: client, to: f, reason: `imports '${reason}'`, chain: chain.join(' → ') };
        out.push({
          rule: id,
          severity: /** @type {'error'|'warn'} */ (rule.severity),
          key: `${id}|${client}|${f}`,
          from: client,
          ...(f !== client ? { to: f } : {}),
          files: chain,
          message: render(rule.message ?? DEFAULTS.message, vars),
          fix: render(rule.fix ?? DEFAULTS.fix, vars),
        });
        continue; // don't look past a server-only module
      }
      for (const next of adj.get(f) ?? []) {
        if (prev.has(next)) continue;
        prev.set(next, f);
        queue.push(next);
      }
    }
  }
  return out;
}
