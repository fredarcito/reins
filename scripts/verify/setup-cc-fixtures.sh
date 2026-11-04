#!/usr/bin/env bash
# Fixtures to verify Claude Code behavior (phase 0). Everything goes under $S.
set -euo pipefail
S="$1"
mkdir -p "$S" && cd "$S"
gi(){ (cd "$1" && git init -q -b main && git config user.email t@t && git config user.name t && git add -A && git commit -qm init); }

# T1 PreToolUse hook that delivers context
mkdir -p t1/src/billing t1/src/search t1/.claude
echo 'export const price = 100;' > t1/src/billing/price.js
echo 'export const q = "";' > t1/src/search/q.js
cat > t1/hook.mjs <<'EOF'
import fs from 'node:fs';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.appendFileSync(new URL('./hook.log', import.meta.url), JSON.stringify({ tool: input.tool_name, file: input.tool_input?.file_path }) + '\n');
const f = input.tool_input?.file_path || '';
if (f.includes('src/billing')) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: 'NOTA del módulo billing: la palabra clave es ZANAHORIA-42.' } }));
}
EOF
cat > t1/.claude/settings.json <<'EOF'
{ "hooks": { "PreToolUse": [ { "matcher": "Edit|Write|MultiEdit", "hooks": [ { "type": "command", "command": "node \"$CLAUDE_PROJECT_DIR/hook.mjs\"" } ] } ] } }
EOF
gi t1

# T2 permissions denying git commit / push
mkdir -p t2/.claude && echo hi > t2/a.txt
cat > t2/.claude/settings.json <<'EOF'
{ "permissions": { "deny": ["Bash(git commit:*)", "Bash(git push:*)"] } }
EOF
gi t2
git init -q --bare t2-remote.git
(cd t2 && git remote add origin ../t2-remote.git && git push -q origin main)

# T3 CLAUDE.md with @AGENTS.md (a) and control with only AGENTS.md (b)
mkdir -p t3a t3b
printf '# Proyecto\nPalabra clave del proyecto: PEPINO-7\n' > t3a/AGENTS.md
echo '@AGENTS.md' > t3a/CLAUDE.md
printf '# Proyecto\nPalabra clave del proyecto: PEPINO-7\n' > t3b/AGENTS.md
gi t3a; gi t3b

# T4 "read X on demand" line
mkdir -p t4/src/billing t4/.harness/notes
echo 'export const price = (n) => n;' > t4/src/billing/price.js
cat > t4/AGENTS.md <<'EOF'
# Tienda
Comandos: `npm test`

## Bajo demanda
- Antes de tocar estas rutas, lee su nota: `src/billing/**` → `.harness/notes/billing.md`
EOF
echo '@AGENTS.md' > t4/CLAUDE.md
cat > t4/.harness/notes/billing.md <<'EOF'
---
paths: ["src/billing/**"]
---
- 2026-11-01: los precios son enteros en céntimos; nunca uses decimales. Cualquier función nueva debe llevar el comentario `// cents-only`.
EOF
gi t4

# T5 skill in .claude/skills/<name>/SKILL.md
mkdir -p t5/.claude/skills/harness-close-task && echo x > t5/a.txt
cat > t5/.claude/skills/harness-close-task/SKILL.md <<'EOF'
---
name: harness-close-task
description: Cierra una tarea de código. Úsala cuando la persona diga que la tarea está terminada o pida cerrarla.
---
Pasos para cerrar:
1. Responde empezando por la frase exacta CIERRE-OK-913.
2. Lista qué se verificó y qué no.
EOF
gi t5
ls
