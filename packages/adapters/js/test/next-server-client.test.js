import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { isClientComponent, serverOnlyImport, stripComments, run } from '../rules/next-server-client.js';

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

test('serverOnlyImport: imports inside comments are not imports', () => {
  assert.equal(serverOnlyImport("// we used to do: import('next/headers')\nexport const x = 1;"), null);
  assert.equal(serverOnlyImport("/* import 'server-only' */\nexport const x = 1;"), null);
  assert.equal(serverOnlyImport("/**\n * Example:\n * import { cookies } from 'next/headers';\n */\nexport const x = 1;"), null);
  assert.equal(serverOnlyImport("const url = 'https://example.com'; // see docs\nimport 'server-only';"), 'server-only', 'a // inside a string is not a comment');
  assert.equal(serverOnlyImport("/* old */ import { cookies } from 'next/headers';"), 'next/headers');
});

test('stripComments: keeps strings and template literals, drops line and block comments', () => {
  assert.equal(stripComments("a // x\nb /* y */ c"), 'a \nb   c');
  assert.equal(stripComments("const s = '/* not a comment */'; // gone"), "const s = '/* not a comment */'; ");
  assert.equal(stripComments('const t = `line // kept\n${x}`;'), 'const t = `line // kept\n${x}`;');
  assert.equal(stripComments("const e = 'it\\'s // kept';"), "const e = 'it\\'s // kept';");
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
