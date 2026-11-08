import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cli, exampleRepo, git } from './helpers.js';
import { hookResponse } from '../src/commands/notes.js';

const write = (dir, f, text) => {
  mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
  writeFileSync(path.join(dir, f), text);
};
const MAP = '.reins/progress/.impact-map.json';

/** next-app with its impact map built, on a feature branch. */
async function repo() {
  const dir = exampleRepo('next-app');
  git(dir, 'switch', '-qc', 'feat/x');
  const r = await cli(dir, ['impact', '--map']);
  assert.equal(r.stdout, `Wrote ${MAP}: 13 imported files.\n`, r.stderr);
  return dir;
}
const said = (dir, file, session = 's1') => {
  const r = hookResponse(dir, { session_id: session, hook_event_name: 'PreToolUse', tool_input: { file_path: path.join(dir, file) } });
  return r ? JSON.parse(r).hookSpecificOutput.additionalContext : null;
};
const triage = (dir, level) => write(dir, '.reins/progress/triage.log', `2026-11-04 | feat/x | ${level} | the task | commit:${git(dir, 'rev-parse', 'HEAD').trim()}\n`);

test('impact --map: the same importers count and level as `reins impact`', async () => {
  const dir = await repo();
  const map = JSON.parse(readFileSync(path.join(dir, MAP), 'utf8')).files;
  for (const f of ['src/features/orders/types.ts', 'src/lib/date.ts', 'src/features/billing/tax.ts']) {
    const one = JSON.parse((await cli(dir, ['impact', f, '--json'])).stdout);
    assert.deepEqual([map[f].consumers, map[f].level], [one.consumers.length, one.level], f);
  }
  assert.equal(map['src/app/page.tsx'], undefined, 'files nobody imports are left out');
});

test('notes hook: warns when a shared file is touched under a lower declared level, once per file and session', async () => {
  const dir = await repo();
  triage(dir, 'medium');
  const first = said(dir, 'src/features/orders/types.ts');
  assert.match(first ?? '', /^Impact of changing src\/features\/orders\/types\.ts \(from reins impact\): imported by 4 files \(domains: orders\)\. Minimum level if the change breaks its importers: large \(touches a public API \(src\/features\/orders\/index\.ts\)\)\.\nThis task is declared medium\. Before editing it: tell the person the task is large, run `npx reins triage large "<reason>"` and present the plan; wait for confirmation\./);
  assert.equal(said(dir, 'src/features/orders/types.ts'), null, 'once per file and session');
  assert.match(said(dir, 'src/features/orders/types.ts', 's2') ?? '', /^Impact of changing/, 'another session is warned too');
  assert.equal(said(dir, 'src/lib/date.ts'), null, 'small is within medium: silence');

  triage(dir, 'large');
  assert.equal(said(dir, 'src/features/orders/OrderList.tsx'), null, 'declared large: silence');
});

test('notes hook: an untriaged task is told once to triage; no map, no word about impact; notes still arrive', async () => {
  const dir = await repo();
  assert.match(said(dir, 'src/lib/date.ts') ?? '', /No level is declared for this task yet: triage it first .*at least small\./);
  assert.equal(said(dir, 'src/lib/db.ts'), null, 'the untriaged reminder is not repeated per file');
  assert.match(said(dir, 'src/features/orders/types.ts') ?? '', /at least large\./, 'but comes back when a file needs more');

  write(dir, '.reins/notes/orders.md', '---\npaths: ["src/features/orders/**"]\n---\n## Purpose\nOrders.\n');
  write(dir, MAP, 'not json');
  triage(dir, 'small');
  assert.match(said(dir, 'src/features/orders/OrderList.tsx', 's3') ?? '', /^Module notes for src\/features\/orders\/OrderList\.tsx/, 'a broken map never hides the notes');
});
