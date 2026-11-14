// Cargo packages of a repo and their crate roots (lib, bins, build script, tests, examples, benches), read from each
// Cargo.toml as text: only `[package]`, `[lib]`, `[[bin]]`/`[[test]]`/`[[example]]`/`[[bench]]` names and paths,
// and `build`. Workspaces need nothing special: every member has its own Cargo.toml.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * @typedef {'lib' | 'bin' | 'build' | 'test' | 'example' | 'bench'} CrateKind
 * @typedef {{ kind: CrateKind, name: string, root: string }} CrateRoot  `root`: repo-relative path of the root file
 * @typedef {{ dir: string, name: string, edition: string, crates: CrateRoot[] }} CargoPackage
 * @typedef {{ table: string, array: boolean, values: Record<string, string> }} ManifestSection
 */

const SECTION_HEADER = /^(\[\[?)\s*([\w.-]+)\s*\]\]?$/;
const KEY_VALUE = /^([\w.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|(true|false))/;

/**
 * The tables of a Cargo.toml: `[name]` and `[[name]]` sections with their `key = "string"` pairs.
 * Good enough for names, paths and the edition; anything else is ignored.
 * @param {string} text
 * @returns {ManifestSection[]}
 */
export function readManifest(text) {
  /** @type {ManifestSection[]} */
  const sections = [{ table: '', array: false, values: {} }];
  for (const rawLine of text.split('\n')) {
    const line = rawLine.replace(/\s#.*$/, '').trim();
    const header = line.match(SECTION_HEADER);
    if (header) {
      const [, brackets, table] = header;
      sections.push({ table, array: brackets === '[[', values: {} });
      continue;
    }
    const pair = line.match(KEY_VALUE);
    if (!pair) continue;
    const [, key, doubleQuoted, singleQuoted, boolean] = pair;
    sections[sections.length - 1].values[key] = doubleQuoted ?? singleQuoted ?? boolean;
  }
  return sections;
}

/** Cargo turns `my-crate` into the crate name `my_crate`. */
const crateName = (packageName) => packageName.replace(/-/g, '_');

/** `.rs` files right inside `dir`, plus `dir/<x>/main.rs` (Cargo's auto-discovered bins, tests, examples, benches). */
function targetsIn(repoRoot, dir) {
  const absolute = path.join(repoRoot, dir);
  if (!existsSync(absolute)) return [];
  const targets = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.rs')) targets.push({ name: entry.name.slice(0, -'.rs'.length), file: `${dir}/${entry.name}` });
    else if (entry.isDirectory() && existsSync(path.join(absolute, entry.name, 'main.rs'))) targets.push({ name: entry.name, file: `${dir}/${entry.name}/main.rs` });
  }
  return targets.sort((first, second) => (first.file < second.file ? -1 : 1));
}

/** Where Cargo looks for each kind of target when the manifest does not list it. */
const TARGET_FOLDERS = { bin: 'src/bin', test: 'tests', example: 'examples', bench: 'benches' };

/**
 * @param {string} repoRoot real path of the repo
 * @param {string} dir repo-relative folder of the Cargo.toml ('' at the root)
 * @returns {CargoPackage | null} null for a manifest without `[package]` (a virtual workspace)
 */
export function readPackage(repoRoot, dir) {
  const sections = readManifest(readFileSync(path.join(repoRoot, dir, 'Cargo.toml'), 'utf8'));
  const packageSection = sections.find((section) => section.table === 'package' && !section.array);
  if (!packageSection) return null;
  const inPackage = (relative) => path.posix.normalize(dir ? `${dir}/${relative}` : relative);
  const name = packageSection.values.name ?? path.posix.basename(dir || '.');
  /** @type {CrateRoot[]} */
  const crates = [];
  /** @param {CrateKind} kind */
  const addCrate = (kind, targetName, file) => {
    if (existsSync(path.join(repoRoot, file)) && !crates.some((crate) => crate.root === file)) crates.push({ kind, name: crateName(targetName), root: file });
  };

  const libSection = sections.find((section) => section.table === 'lib');
  addCrate('lib', libSection?.values.name ?? name, inPackage(libSection?.values.path ?? 'src/lib.rs'));
  const build = packageSection.values.build;
  if (build !== 'false') addCrate('build', 'build_script_build', inPackage(build && build !== 'true' ? build : 'build.rs'));

  for (const [kind, folder] of /** @type {[CrateKind, string][]} */ (Object.entries(TARGET_FOLDERS))) {
    for (const section of sections.filter((candidate) => candidate.array && candidate.table === kind)) {
      const targetName = section.values.name ?? '';
      const defaultFile = kind === 'bin' && targetName === name ? 'src/main.rs' : `${folder}/${targetName}.rs`;
      addCrate(kind, targetName || name, inPackage(section.values.path ?? defaultFile));
    }
    if (kind === 'bin') addCrate('bin', name, inPackage('src/main.rs'));
    for (const target of targetsIn(repoRoot, inPackage(folder))) addCrate(kind, target.name, target.file);
  }
  // `edition.workspace = true`: the workspace's edition, 2018 or later in practice
  const edition = packageSection.values.edition ?? (packageSection.values['edition.workspace'] === 'true' ? '2021' : '2015');
  return { dir, name, edition, crates };
}
