# Presets are JS modules (2026-11-10)

The JS adapter kept its presets as YAML files plus shared fields merged in code; the Rails adapter wrote its preset as an object inside `src/`. Two shapes for the same thing, and in the YAML one a reader could not see where half of the preset came from.

| Topic | Decision | Why |
| --- | --- | --- |
| Format | Every adapter: `presets/<name>.js`, one file per preset, default export a plain object; `src/presets.js` lists them and `loadPreset` returns a copy | An adapter is a JS package whatever language it reads, so this layout works for every adapter (Rails today, Rust next) with no dependency |
| Shared fields | A preset spreads them (`...CONVENTIONS`) and replaces what differs, in the same file | The composition is written where it is read. With YAML it was a merge in another file, explained by a comment in each preset |
| What is given up | "Presets are YAML data, not code" (2026-11-04): a preset could now run code, and a tool without Node can't read it | An adapter is already code that runs, so nothing new is trusted. Presets are internal to the adapter package: teams edit `architecture.yml`, which stays YAML. No tool reads presets from outside |
| Dependency | `yaml` removed from `adapter-js` | Its only use was reading presets |
| Check | `loadPreset` of the five presets compared before and after: deep-equal | |
