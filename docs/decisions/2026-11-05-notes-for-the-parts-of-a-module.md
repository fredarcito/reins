# Notes for the parts of a module (2026-11-05)

| Topic | Decision | Why |
| --- | --- | --- |
| Parts get notes, not domains | `init` drafts one note per part of a route domain (e.g. `companies/[slug]/salaries`): looks through `(group)`, `[param]` and single-folder chains, needs 2+ source files, at most 12 per domain. Parts never become domains | One note for a module with eight tabs is long and generic; a domain per tab would add boundaries that aren't real. Notes add context, not rules |
| Layout | `.reins/notes/<module>.md` plus `.reins/notes/<module>/<part>.md`, one level deep; the module's note stays outside its folder | The relation is explicit (no guessing from globs), 50+ flat files are hard to browse, and a module that later gains parts doesn't move its note. Mirroring the source tree was rejected: it breaks whenever code moves |
| Order and index | `notesFor` returns the most general note first; `sync` puts a module's parts on its line in `AGENTS.md` | The shared context is read before the specifics; `AGENTS.md` is paid on every session |
| `note-layout` (warn) | Flags notes deeper than one folder, parts without their module note, and parts whose paths are outside the module's folders | Cheap checks that keep the layout meaningful |
| Feature domains | Only route domains get parts drafted | Inside `features/x` the subfolders are usually `components/`, `hooks/`: a note per folder would be noise |
