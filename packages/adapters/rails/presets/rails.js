// Preset for a Ruby on Rails app.
// `reins init` uses `layers` as a starting point and keeps only the folders that exist; the import graph decides
// the final order.
export default {
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

  // What `reins init` needs to know about Ruby. There is no index-file convention (no `index_files`), so a domain's
  // public API is what the rest of the app already uses; and no route folders (no `route_segments`).
  sources: ['**/*.{rb,rake}'],
  tests: ['{spec,test}/**', '**/{spec,test}/**', '**/*_{spec,test}.rb'],
  // files outside every layer are reported by their folder inside app/ (app/ops), not as one big "app"
  source_roots: ['app'],

  // entry points by convention (Rails loads them itself): never reported as orphans
  entries: [
    'config/**', 'db/**', 'bin/**', 'lib/tasks/**', 'spec/**', 'test/**',
    'app/controllers/**', 'app/channels/**', 'app/helpers/**', 'app/mailers/previews/**',
  ],
};
