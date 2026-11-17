# Impact through the notes hook (2026-11-08)

Agents still skipped `reins impact`, this repo's own agent included (2026-11-08: core's public API changed under a declared `medium`; doctor caught it only at the end). The rule is read at session start but applies right before an edit, where nothing recalls it — the same failure notes had before their hook.

| Topic | Decision | Why |
| --- | --- | --- |
| Where | The existing `PreToolUse` notes hook (Read, Edit, Write) adds the impact warning | The agent reads before editing, so it arrives in time (P1). No new hook to install |
| When it speaks | Only when the file has importers **and** the declared level of the current task (same window as doctor) is lower than impact's minimum, or no level is declared. Once per file and session; while untriaged, once per minimum level | An actionable "stop and re-triage" at the right moment, not one more line per file read |
| Cost | `reins impact --map` (importers count and level of every imported file, one pass over the graph, same `scopeSignals`/`suggestLevel` as `impact`) runs detached from the `SessionStart` hook into `.reins/progress/.impact-map.json`; the notes hook only reads it. ~0.7 s on this repo, off the critical path | Building the graph per edit costs seconds on large repos. Not on compaction; only when `CLAUDE_PROJECT_DIR` is set (Claude Code) |
| Staleness | The map is from session start; imports added during the session are not in it | Shared files rarely change shape mid-session; the next session rebuilds it |
| Not built | Denying the first edit of a shared file | Intrusive and untested (P1 only verified delivering context); only if warnings turn out not to be enough |
| Other agents | Unchanged: the `AGENTS.md` rule and doctor's `triage-mismatch` afterwards | No provider-neutral way to intercept an edit |
