# Notes before exploring (2026-11-12)

In DEV-8939 (repvue-employer, reins 0.15.0) the agent explored the code first (with `cat`, `sed` and `grep` in Bash, which the notes hook does not see), ran `triage` afterwards because it needed the files, and read the module note just before editing, when it could no longer save anything. The note did not cover the area either (`JobMatches/` had grown inside a module whose note described an older page).

| Topic | Decision | Why |
| --- | --- | --- |
| Notes come from the first step | `reins triage "<reason>"` without files and without a level suggests the likely notes and records nothing; the rule says to run it before reading or searching code | `triage` is the step every agent already runs first. A separate rule ("read the notes first") depends on the agent remembering; a hook only reaches Claude Code |
| How it finds them | Plain word matching (`suggestNotes` in core): reason words against note names and paths (3 points), names of the repo folders a note covers (3), its body (1, +1 when the word appears 5+ times); light English stemming; English and Spanish stopwords; test and fixture folders left out | Deterministic, no model, no network, no key: reins measures and the agent interprets. Folder names reach a module whose note fell behind its code |
| `--files` also prints notes | The notes of those files, once per session (shared with the hook's record) | The agent that already knows its files still gets the notes before editing |
| Notes guide, code decides | Hook and triage say "start from them; the code wins if they disagree, and say so" (was "follow them") | A stale note obeyed is worse than no note; the disagreement is how a note gets fixed |
| Purpose in the AGENTS.md index | Each line ends with the first sentence of the note's `## Purpose` | A task reaches a module by what it does, not only by its folder names; no per-domain aliases to maintain |
| `note-uncovered` | Doctor warns when the task changed a sizeable direct subfolder of a module (≥ `notes.uncovered_min_files`, default 10) that its note never names | Delivering a note faster helps only if it covers the area; only folders the task touched, so the fix is cheap and the agent knows them |
| Hook matcher | `Read\|Edit\|Write\|MultiEdit\|Grep\|Glob`; a folder gets the notes of the files inside it, the repo root none | Grep and Glob pass `path`; free to add |
| Not done | A hook on Bash (extracting paths from shell commands) | A cost on every shell command and fragile parsing; revisit if agents still explore before `triage` in real sessions. Done 2026-11-14, see "Guards against skipping reins" |
