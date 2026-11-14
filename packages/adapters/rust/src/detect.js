import { existsSync } from 'node:fs';
import path from 'node:path';

/** Where a Tauri app keeps its Rust crate. */
export const TAURI_DIR = 'src-tauri';

/**
 * A Rust repo: a Cargo.toml at the root, or in src-tauri/ (a Tauri app, whose root is the web frontend).
 * @param {string} repoPath
 */
export function detect(repoPath) {
  return existsSync(path.join(repoPath, 'Cargo.toml')) || existsSync(path.join(repoPath, TAURI_DIR, 'Cargo.toml'));
}

/**
 * @param {string} repoPath
 * @returns {'cargo' | 'tauri' | null}
 */
export function suggestPreset(repoPath) {
  if (existsSync(path.join(repoPath, 'Cargo.toml'))) return 'cargo';
  return existsSync(path.join(repoPath, TAURI_DIR, 'Cargo.toml')) ? 'tauri' : null;
}
