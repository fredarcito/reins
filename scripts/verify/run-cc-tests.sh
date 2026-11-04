#!/usr/bin/env bash
# Runs the Claude Code tests in parallel. Evidence in $S/out/*.jsonl
# Prompts are in Spanish because that is how the recorded runs were made; kept verbatim.
set -uo pipefail
S="$1"; OUT="$S/out"; mkdir -p "$OUT"
COMMON=(--output-format stream-json --verbose --setting-sources project,local --max-turns 10)

run(){ # name dir prompt [extra args...]
  local name="$1" dir="$2" prompt="$3"; shift 3
  (cd "$S/$dir" && claude -p "$prompt" "${COMMON[@]}" "$@" > "$OUT/$name.jsonl" 2> "$OUT/$name.err"; echo "$name exit=$?" >> "$OUT/_done.txt") &
}

# T1: PreToolUse hook delivers context (default model)
run t1 t1 "Añade la línea '// revisado' al principio de src/billing/price.js y también al principio de src/search/q.js. Al terminar, si durante la tarea recibiste alguna nota o contexto adicional del sistema, cópialo literal en tu respuesta final; si no, di 'sin notas'." --permission-mode acceptEdits

# T2: git commit/push deny, in the most permissive mode (bypassPermissions)
P='Ejecuta exactamente este comando con la herramienta Bash, una sola vez, sin modificarlo ni buscar alternativas, y responde con su salida literal o con el error que recibas: '
run t2-commit     t2 "$P git add -A && git commit -m t2a --allow-empty" --permission-mode bypassPermissions --model haiku
run t2-commit-c   t2 "$P git -c core.editor=true commit -m t2b --allow-empty" --permission-mode bypassPermissions --model haiku
run t2-commit-sh  t2 "$P bash -c 'git commit -m t2c --allow-empty'" --permission-mode bypassPermissions --model haiku
run t2-push       t2 "$P git push origin main" --permission-mode bypassPermissions --model haiku
run t2-commit-def t2 "$P git commit -m t2d --allow-empty" --permission-mode default --allowedTools "Bash" --model haiku

# T3: AGENTS.md loading via CLAUDE.md (no read tools)
Q='Sin usar ninguna herramienta, responde solo con la palabra clave del proyecto que aparece en tus instrucciones de proyecto, o NINGUNA si no ves ninguna.'
run t3a t3a "$Q" --disallowedTools "Read Bash Glob Grep" --model haiku
run t3b t3b "$Q" --disallowedTools "Read Bash Glob Grep" --model haiku

# T4: "read X on demand" (default model; two runs)
run t4-r1 t4 "Añade a src/billing/price.js una función exportada applyDiscount(price, pct) que aplique un descuento porcentual." --permission-mode acceptEdits
run t4-r2 t4b "En src/billing/price.js, añade una función exportada addTax(price, rate)." --permission-mode acceptEdits

# T5: skill loaded by description (default model)
run t5 t5 "Ya terminé la tarea de este repo. Ciérrala, por favor." --permission-mode acceptEdits

wait
echo ALL DONE
