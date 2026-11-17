# Phase 7 defaults (`audit`, `progress`, `review`; experimental)

| Topic | Decision | Why |
| --- | --- | --- |
| Backlog file | `.reins/backlog/optimizations.md` (local), plain markdown, one finding per line: `- [open\|done\|wontfix] [recheck]? A<n> · date · \`path\` · finding — status date: reason` | Readable by people and agents, editable line by line, survives hand edits around it |
| Backlog ids | `A1`, `A2`… (max + 1) | Short, stable references for `audit set` |
| Duplicates | `audit add` refuses the same path + text (case-insensitive) as any existing finding, including `wontfix` | The design's point: don't propose the same thing again |
| Status changes | `done` and `wontfix` need a reason; reopening doesn't; any status change clears `recheck`. `wontfix` prints a hint to move durable reasons to the module note | Design |
| Recheck | `audit recheck <id…>` or `audit recheck open` flags findings; `list --recheck` shows them | "mark for re-verification" |
| Invalid backlog | Reported by `list`; every edit refuses to work on an invalid file | Never build on a broken file |
| `progress` actions | `new [--hot]`, `show`, `add [--criteria]`, `start`, `done`, `drop <reason>`, `next`. No `close`: only the person closes | Design lists done/add/next; start/drop cover the other two markers; new uses the templates |
| Item numbers | 1-based, file order, across all sections; `show` prints them | One numbering for every command |
| `start` | Puts any other `[~]` back to `[ ]` and says so | Only one in progress; the agent switching tasks shouldn't fail |
| Validity | Every edit: parse → refuse if invalid → apply → bump `updated:` → re-validate before writing. A refused edit writes nothing | Criterion: "progress never leaves the notebook badly formatted"; tested with 500 random edit sequences |
| `review` | Prints a prompt: instructions, changed files, `.reins/review/checklist.md` (template as fallback), notes of touched paths, and the diff against the merge base, including uncommitted and untracked files (local `.reins/progress|backlog` excluded). Diff truncated at 200 KB (`--max-bytes`) with a notice | Design: no API calls; any agent can use the prompt |
| Executors | `EXECUTORS` map in `commands/review.js`; only `print` exists; `--executor` selects one | Extension point for a future runner, without building it |
