// Probe: logs what each hook receives and answers with a keyword, to see which ones reach the model.
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const event = process.argv[2];
let raw = '';
for await (const c of process.stdin) raw += c;
let input = null;
try { input = JSON.parse(raw); } catch { input = raw; }
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => /CURSOR|CLAUDE|SESSION|CONVERSATION|REINS/i.test(k)));
const log = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'probe.log');
appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), event, input, env }) + '\n');
const sid = input?.session_id ?? input?.conversation_id ?? 'none';
const out = {
  sessionStart: { additional_context: 'PROBE keyword TORTUGA-7 (from Cursor sessionStart additional_context).', env: { REINS_SESSION: String(sid) } },
  preToolUse: { permission: 'allow', agent_message: 'PROBE keyword BETA-5 (from Cursor preToolUse agent_message on allow).' },
  postToolUse: { additional_context: `PROBE keyword ALFA-3 (from Cursor postToolUse additional_context, tool ${input?.tool_name}).` },
  beforeReadFile: { permission: 'allow' },
  beforeShellExecution: { permission: 'allow' },
  'claude-SessionStart': { hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'PROBE keyword GAMMA-9 (from a Claude Code format SessionStart hook in .claude/settings.json).' } },
  'claude-PreToolUse': { hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'PROBE keyword DELTA-2 (from a Claude Code format PreToolUse hook in .claude/settings.json).' } },
}[event] ?? {};
process.stdout.write(JSON.stringify(out));
