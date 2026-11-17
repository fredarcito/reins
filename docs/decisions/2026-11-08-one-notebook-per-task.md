# One notebook per task (2026-11-08, phase 1)

Design and the cases it covers: [`proposals/multi-session-progress.md`](../proposals/multi-session-progress.md). A branch had one notebook, so tasks one after another, parallel sessions on one feature and a fresh session per task all collided on it.

| Topic | Decision | Why |
| --- | --- | --- |
| Unit | One notebook per **task**, `.reins/progress/<branch>/<task>/notebook.md`; the task folder holds its cold files and agent reports | A task outlives a session (a new session continues it) and several tasks share a branch. A task is one folder: reading, closing or deleting it touches one place |
| Rejected | A. one notebook per session (a new session can't continue a task); C. one per branch, closed ones skipped (breaks parallel sessions and a new session with the previous task open); D. one file per branch with a block per session (unsafe concurrent writes without a lock) | See the proposal, section 4 |
| Session | `session:` in the header holds the last session that claimed the task: from the hook payload, `CLAUDE_CODE_SESSION_ID` (verified, P11) or `REINS_SESSION`. No ownership check | Every `reins progress` command claims what it acts on, so compaction and `/clear` find the task again |
| Reading | `progress show` does not claim (2026-11-10); only commands that edit do | An agent ran `show --task` to see what another session had done and silently became the task's owner, so that session lost it. Looking is not continuing |
| Choosing | Explicit `--task`/`REINS_TASK`; else the open task this session claimed; else none, and `resume` lists the open tasks. Never taken silently | At session start reins can't tell "continue yesterday's task" from "next task"; the person's first message can |
| Compatibility | No migration. Without a session id and one open notebook, it is used, as before. The older `<branch>.md` keeps working as a task without a name until it is closed; its cold files are the plain files of `<branch>/` | Agents without session ids (Codex, Cursor) and notebooks in progress keep working |
| Read view | `resume` shows the own notebook in full, other open tasks in 1–2 lines (5 at most), closed ones in one line only while others are open | About 100 tokens per session with three parallel sessions; nothing extra with one |
| Cleanup | `resume`, fixed 7-day margin: closed → deleted 7 days after closing or with its branch; open → only when its branch is gone and it has not changed for 7 days. Open removals add one line; the rest is silent. Uses the A2 `liveBranches` helper | Nothing piles up, and open work on a live branch is never lost |
| Overlaps | Policy only: the agent asks the person and writes one line in its own notebook | The person already talks to every session |
| Deferred to phase 2 | Feature notebook, `**Needs:**` requests between tasks, "new from other sessions" after each edit, cleanup log and configurable margin | Built only if real use asks for them |
