// Preset for a Vite frontend inside a Rails app (vite_rails, usually with Inertia): the code lives in app/frontend
// (or app/javascript) instead of src/. Use it together with the Rails adapter: `adapters: [rails, js]`.
// `reins init` uses `layers` as a starting point and keeps only the folders that exist.
import { CONVENTIONS } from '../src/conventions.js';

export default {
  ...CONVENTIONS,
  description: 'Vite frontend inside a Rails app (Inertia)',

  layers: [
    { name: 'pages', paths: ['app/{frontend,javascript}/{pages,Pages}/**', 'app/{frontend,javascript}/entrypoints/**'] },
    { name: 'features', paths: ['app/{frontend,javascript}/{features,modules}/**'] },
    { name: 'components', paths: ['app/{frontend,javascript}/{components,layouts,ui}/**'] },
    { name: 'shared', paths: ['app/{frontend,javascript}/{hooks,lib,utils,services,api,store,types,constants,context,config}/**'] },
  ],

  domains_from: ['app/{frontend,javascript}/{features,modules}/*'],
  // With no domain folder above, each folder of pages becomes a domain (pages/users/ → users), as with routes.
  route_domains_from: ['app/{frontend,javascript}/{pages,Pages}/*'],

  // Replaces the shared value: in a pages folder `index.tsx` is the index page, not a barrel, so there is no
  // index-file convention here. A domain's public API is its pages plus what the rest of the code already imports.
  index_files: [],

  // Replaces the shared value: the code lives here, not in src/.
  source_roots: ['app/frontend', 'app/javascript'],

  // Vite loads the entrypoints, and Inertia resolves the pages by name at run time (import.meta.glob), so nothing
  // imports them: never reported as orphans.
  entries: [
    'app/{frontend,javascript}/entrypoints/**',
    'app/{frontend,javascript}/{pages,Pages}/**',
    'vite.config.*',
    '**/*.{test,spec}.{js,jsx,ts,tsx}',
    '**/*.stories.{js,jsx,ts,tsx}',
  ],
};
