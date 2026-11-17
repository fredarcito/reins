# Shell edits and module notes (2026-11-17)

repvue-employer (reins 0.17.0) reported an agent that edited files with `python3 -c` scripts and never got the module notes: the hooks only saw the file tools. 0.18.0 already gave the notes hook `Bash`, but it only took words that were existing paths, so inline code, `>file` and new files slipped through, and a script file (`python3 fix.py`) names nothing at all.

| Topic | Decision | Why |
| --- | --- | --- |
| Paths in shell edits | `shellPaths` also splits on the quotes, brackets, commas and `=` of inline code (`open('src/x.js','w')`), strips glued redirections (`>f`, `2>>f`), and takes a file that does not exist yet when it is a redirection, `tee` or `touch` target, or has a folder and an extension whose folder exists | Editing through the shell is legitimate (one `sed -i` over 30 files instead of 30 reads and edits); what matters is that the command names its files |
| Rule in AGENTS.md | Appended to the "never commit" line: edit with the edit tool; a shell edit names its files in the command, never only inside a script | A new line would push this repo's AGENTS.md past 45 lines and collapse the notes index; the rule only steers, it guarantees nothing |
| `note-unseen` | Doctor flags a module the task changed whose note this session never received (hook, `triage`, `resume`, `reins notes`, or reading the note file). Every level; skipped without a session id (CI, a person's terminal). `progress close` refuses on it like on the other note rules; `--notes-ok "<why>"` still overrides | The diff is the only place that sees every edit, scripts included. Closing is late, but it guarantees no closed task skipped a note, and each warning counts a case the hooks missed |
| Not done | Blocking shell edits | It breaks codegen, formatters and `mv`; a configurable block is complexity no real case asked for |
