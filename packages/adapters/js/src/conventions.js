// What `reins init` needs to know about JavaScript and TypeScript, shared by every preset of this adapter: which
// files are source, which are tests, which file is a folder's public API, which files nobody imports by design,
// how route folders are named and where the code lives. Each preset spreads it (`...CONVENTIONS`) and may replace
// a field. Changing a value here changes the draft `reins init` writes for every JS repo.
export const CONVENTIONS = Object.freeze({
  sources: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
  tests: ['**/*.{test,spec,stories}.*', '**/{__tests__,__mocks__,test,tests,e2e}/**'],
  index_files: ['index.js', 'index.jsx', 'index.mjs', 'index.ts', 'index.tsx'],
  orphans_ignore: ['**/?*.config.*', '**/*.d.ts'],
  // Route folders (Next's names; harmless elsewhere), as regular expressions on one folder name. The first capture
  // group is the name without the marker.
  route_segments: {
    groups: ['^\\((.+)\\)$'], // (main): routes sharing a layout, not part of the URL
    params: ['^\\[([^.[\\]][^\\]]*)\\]$'], // [slug]
    skipped: ['^(\\[\\[?\\.\\.\\.|_)'], // [...rest], [[...slug]], _private: never modules
  },
  // folders that only hold the code: files outside every layer are reported one level inside them (src/store)
  source_roots: ['src'],
  // with TypeScript sources, the rules of the drafted plan ignore type-only imports: they never run
  ignore_kinds: [{
    kind: 'type',
    if_files: ['**/*.{ts,tsx,mts,cts}'],
    unless_files: ['**/*.d.ts'],
    reason: 'TypeScript detected, so type-only imports are ignored by the rules',
  }],
});
