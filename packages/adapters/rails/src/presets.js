export const PRESETS = Object.freeze(['rails']);

// `reins init` uses `layers` as a starting point and keeps only the folders that exist; the import graph decides
// the final order. `entries` are entry points by convention (Rails loads them itself): never reported as orphans.
const RAILS = {
  description: 'Ruby on Rails app',
  layers: [
    { name: 'web', paths: ['app/controllers/**', 'app/channels/**', 'app/helpers/**', 'app/graphql/**'] },
    {
      name: 'application',
      paths: [
        'app/services/**', 'app/jobs/**', 'app/mailers/**', 'app/operations/**', 'app/interactors/**', 'app/queries/**',
        'app/forms/**', 'app/policies/**', 'app/serializers/**', 'app/presenters/**', 'app/decorators/**',
      ],
    },
    { name: 'models', paths: ['app/models/**', 'app/validators/**'] },
    { name: 'lib', paths: ['lib/**', 'app/lib/**'] },
  ],
  domains_from: ['packs/*', 'engines/*', 'app/domains/*'],
  // what `reins init` needs to know about Ruby: no index file convention, so a domain's public API is what the
  // rest of the app already uses
  sources: ['**/*.{rb,rake}'],
  tests: ['{spec,test}/**', '**/{spec,test}/**', '**/*_{spec,test}.rb'],
  entries: [
    'config/**', 'db/**', 'bin/**', 'lib/tasks/**', 'spec/**', 'test/**',
    'app/controllers/**', 'app/channels/**', 'app/helpers/**', 'app/mailers/previews/**',
  ],
};

/**
 * @param {string} name
 * @returns {import('@agentreins/core/contract').Preset}
 */
export function loadPreset(name) {
  if (!PRESETS.includes(name)) throw new Error(`adapter-rails: unknown preset "${name}" (available: ${PRESETS.join(', ')}).`);
  return structuredClone(RAILS);
}
