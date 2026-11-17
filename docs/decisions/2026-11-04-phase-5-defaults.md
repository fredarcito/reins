# Phase 5 defaults (`doctor`, experimental)

Built after the validation gate without feedback from a real repo ("continue"), so it is **experimental**.

| Topic | Decision | Why |
| --- | --- | --- |
| Level names | `small`, `medium`, `large` (English), in `triage.log` and `doctor.yml` | Everything in the repo is English; the design's Spanish names are not accepted |
| `triage.log` | `.reins/progress/triage.log`, one line per task `YYYY-MM-DD \| branch \| level \| reason`; `#` comments allowed; the **latest** line of the branch counts (escalating = appending a line) | Design format; append-only keeps history |
| Diff | Files changed since the merge base with the base branch (same base-ref search as `check`; since 2026-11-08 the task's triage commit, since 2026-11-11 the branch start first), plus staged, unstaged and untracked files; `.reins/progress/` and `.reins/backlog/` excluded | "The task" is everything on the branch, committed or not |
| Suggested level | `small`: ≤ `max_files` files and ≤ `max_domains` domain; `medium`: more files, ≤ `medium.max_domains` domain; `large`: more domains, a public API file, or `architecture.yml`. Files outside every domain count as files but not as domains | Same thresholds as the planned `reins scope` (design); one function shared by both |
| `triage-mismatch` | Only when the diff needs **more** than declared. Declaring more than needed is not flagged | Design: "the diff exceeds the thresholds of the declared level"; "when in doubt pick the lower level" |
| Malformed `triage.log` lines | Reported under `triage-missing` | No separate rule in the design; the fix is the same (write a valid line) |
| Notebook | `.reins/progress/<branch>.md`, branch characters other than letters, digits, `.`, `_`, `-` become `-` (`feat/x` → `feat-x.md`). Header `# <branch> · status: open\|closed · updated: YYYY-MM-DD` (`\|` also accepted as separator). Items `- [ ]`, `- [~]`, `- [x]`, `- [-] text — reason` (`--` or `reason:` also accepted) | English version of the design's template; one parser shared with `reins progress` (phase 7) |
| `progress-closed` | Looks at items under a "Done criteria" section; if there is none, at every item | Subtasks may stay open when the task is closed; criteria may not |
| Exit code and CI | Always 0 unless `--strict`. When the `CI` environment variable is set, it prints a note and exits 0 without checking | Design: never in CI. The hook is not detected; the templates simply won't call it |
| Report format | Same as `check` (rule, why, fix; text or JSON) without the baseline parts | Design: same error format |
| `doctor.yml` | Optional; unknown keys and negative/non-integer values are errors | Same strictness as `architecture.yml` |
