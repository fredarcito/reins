# Route domains: groups, lone pages, owned folders (2026-11-05)

> Partly superseded by [Owned folders, second version](2026-11-05-owned-folders-second-version.md): how folders join a route domain.

| Topic | Decision | Why |
| --- | --- | --- |
| Route groups | `(x)` folders are looked through like `[param]` | In Next a group only shares a layout; `(main)` as a domain mixed unrelated routes. A group holding one feature (`(companies)/companies`) still gives that feature |
| Same route in several groups | Folders whose path without groups is the same are one domain (and one part) with several folders | Groups are not part of the URL: `(companies)/companies` and `(main)/companies` are both `/companies`. Found on a real repo, where they came out as `companies`, `companies-2`, `companies-3` |
| Lone pages | A route folder needs 2+ source files to be a domain; the rest are listed in the report | Looking through groups would otherwise turn every legal page into a domain with an empty note |
| Logic outside the route | Revised 2026-11-05 after a real repo (see below). Was: a folder joins a domain only when 100% of its imports come from it, descending otherwise | Decided by the import graph so it works for any convention (`components/pages/x`, `components/x`, `views/x`). Matching folder names was rejected: it breaks on `CompanyProfile/` vs `companies` and covers one convention only |
| Partial majorities | Revised 2026-11-05: see "Owned folders, second version" | |
| Closed domains | Reported, not warned | A route domain whose public API is only `page.js` is not "unchecked": `domain-boundary` flags any outside import of its files |
| Feature domains | Unchanged | `features/x` already holds its own components |
| Barrels | The JS adapter reads `index.*` files that only re-export, and the named imports of their importers, and returns `uses` (importer → file behind the barrel). `init` uses them instead of the edges into and out of barrels; rules keep the real edges. Anything it can't resolve (default or namespace import, dynamic import) counts as using everything behind the barrel | With a `components/index.js` barrel every page imports the same file, so no folder could ever look owned. Text, not a parser, because it is JS-specific (adapter) and the conservative fallback keeps mistakes on the safe side |
| Loose files | A file outside every owned folder that only one domain uses (directly or through other such files) joins the domain's note paths, never its `architecture.yml` paths | Notes are context and cannot block anyone; a rule built on "used once today" would break the day a second route uses the file |
