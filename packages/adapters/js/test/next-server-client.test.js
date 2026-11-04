import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isClientComponent, serverOnlyImport, run } from '../rules/next-server-client.js';

test('isClientComponent: directive must be the first statement', () => {
  assert.equal(isClientComponent("'use client';\nexport const a = 1;"), true);
  assert.equal(isClientComponent('// comment\n/* block */\n"use client"\n'), true);
  assert.equal(isClientComponent("import x from 'y';\n'use client';"), false);
  assert.equal(isClientComponent("'use server';"), false);
});

test('serverOnlyImport: server-only and next/headers', () => {
  assert.equal(serverOnlyImport("import 'server-only';"), 'server-only');
  assert.equal(serverOnlyImport("import { cookies } from 'next/headers';"), 'next/headers');
  assert.equal(serverOnlyImport("const h = await import('next/headers');"), 'next/headers');
  assert.equal(serverOnlyImport("import { NextResponse } from 'next/server';"), null);
});

function repo(files) {
  const dir = mkdtempSync(path.join(tmpdir(), 'reins-nsc-'));
  for (const [f, c] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    writeFileSync(path.join(dir, f), c);
  }
  return dir;
}

const files = {
  'client.tsx': "'use client';\nimport './a';\nimport type { T } from './typesOnly';",
  'a.ts': "import './secret';",
  'secret.ts': "import 'server-only';\nimport './deeper';",
  'deeper.ts': "import 'server-only';",
  'typesOnly.ts': "import 'server-only';\nexport type T = 1;",
  'server.tsx': "import './secret';",
};
const edges = [
  { from: 'client.tsx', to: 'a.ts', kind: 'static' },
  { from: 'client.tsx', to: 'typesOnly.ts', kind: 'type' },
  { from: 'a.ts', to: 'secret.ts', kind: 'static' },
  { from: 'secret.ts', to: 'deeper.ts', kind: 'static' },
  { from: 'server.tsx', to: 'secret.ts', kind: 'static' },
];
const cfg = (severity) => ({ rules: { 'next-server-client': { severity } } });

test('reports the nearest server-only module, ignores type-only imports and server components', () => {
  const out = run(repo(files), cfg('warn'), { edges, files: Object.keys(files) });
  assert.deepEqual(out.map((v) => [v.key, v.severity, v.files.join(' > ')]), [
    ['next-server-client|client.tsx|secret.ts', 'warn', 'client.tsx > a.ts > secret.ts'],
  ]);
});

test('a client component that imports a server-only module itself is reported', () => {
  const dir = repo({ 'c.tsx': "'use client';\nimport { cookies } from 'next/headers';" });
  const [v] = run(dir, cfg('error'), { edges: [], files: ['c.tsx'] }); // no local imports at all
  assert.equal(v.key, 'next-server-client|c.tsx|c.tsx');
  assert.equal(v.to, undefined);
});

test('the rule is off unless architecture.yml enables it', () => {
  assert.deepEqual(run(repo(files), { rules: {} }, { edges }), []);
  assert.deepEqual(run(repo(files), cfg('off'), { edges }), []);
});
