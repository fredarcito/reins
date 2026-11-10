// Preset for Next with the app router (plain JS/JSX or TypeScript, with or without src/).
// `reins init` uses `layers` as a starting point and keeps only the folders that exist.
import { CONVENTIONS } from '../src/conventions.js';

export default {
  ...CONVENTIONS,
  description: 'Next.js, app router',

  layers: [
    { name: 'app', paths: ['app/**', 'src/app/**'] },
    { name: 'features', paths: ['features/**', 'src/features/**', 'modules/**', 'src/modules/**'] },
    { name: 'components', paths: ['components/**', 'src/components/**', 'ui/**', 'src/ui/**'] },
    { name: 'shared', paths: ['{lib,hooks,utils,services,actions,types,constants,store,api,context}/**', 'src/{lib,hooks,utils,services,actions,types,constants,store,api,context,config}/**'] },
  ],

  domains_from: ['features/*', 'src/features/*', 'modules/*', 'src/modules/*'],
  // With no domain folder above, each route folder becomes a domain: `[lang]` parameters and `(group)` folders are
  // looked through, folders mostly that route imports join it, one-file routes that own no folder are left out, and
  // one-file routes sharing a feature folder only they use become one domain.
  route_domains_from: ['app/*', 'src/app/*'],

  // adapter rules `reins init` proposes for this preset
  default_rules: ['next-server-client'],

  // Next's special files: Next loads them by convention, so they are never orphans
  entries: [
    '{,src/}app/**/{page,layout,template,loading,error,global-error,not-found,default,route,forbidden,unauthorized}.{js,jsx,ts,tsx}',
    '{,src/}app/**/{opengraph-image,twitter-image,icon,apple-icon,sitemap,robots,manifest}.{js,jsx,ts,tsx}',
    '{,src/}{middleware,instrumentation,instrumentation-client}.{js,ts}',
    'next.config.*',
    '**/*.{test,spec}.{js,jsx,ts,tsx}',
    '**/*.stories.{js,jsx,ts,tsx}',
  ],
};
