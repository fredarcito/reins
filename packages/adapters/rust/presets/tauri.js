// Preset for the Rust half of a Tauri app: the crate lives in src-tauri/, and src/ is the web frontend
// (adapter-js reads it), so only src-tauri/src/* folders become domains.
import { RUST } from './cargo.js';

export default {
  description: 'Rust side of a Tauri app (src-tauri/)',
  layers: [],
  domains_from: ['src-tauri/src/*', 'src-tauri/crates/*'],
  source_roots: ['src-tauri/src'],
  ...RUST,
};
