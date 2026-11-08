# Several agents (large tasks only)

Leader–implementer–reviewer is for large tasks, never the default.

- **Leader (main agent):** plans and coordinates; doesn't edit while subagents are active.
- **Implementers:** one per independent subtask, with no files or dependencies in common.
- **Reviewer:** reads the diff and the `reins check` result; doesn't edit (`reins-reviewer` agent).
- **One file per agent:** each subagent writes its report to the task's folder, `.reins/progress/<branch>/<task>/<agent>_<subtask>.md`, and replies only `done -> <path>`. The leader reads the reports and updates the notebook. No concurrent writes, no broken telephone.
- Subtasks that share files or depend on each other run in series. If the task turns out small, lower the level.
- Subagents never commit either.
