// Dependency edges of a fake Next app. Each comment says what the rules should report.
export const edges = [
  { from: 'src/app/page.js', to: 'src/features/billing/index.js', kind: 'static' }, // ok: pages -> features, public API
  { from: 'src/components/PriceTag.js', to: 'src/features/billing/index.js', kind: 'static' }, // layer-direction: components -> features
  { from: 'src/app/checkout/page.js', to: 'src/features/billing/total.js', kind: 'static' }, // domain-boundary: billing internals
  { from: 'src/features/search/Results.js', to: 'src/features/billing/total.js', kind: 'static' }, // allowed by allow:
  { from: 'src/features/billing/index.js', to: 'src/features/billing/total.js', kind: 'static' }, // ok: same domain
  { from: 'src/lib/a.js', to: 'src/lib/b.js', kind: 'static' }, // no-cycles: a -> b -> c -> a
  { from: 'src/lib/b.js', to: 'src/lib/c.js', kind: 'static' },
  { from: 'src/lib/c.js', to: 'src/lib/a.js', kind: 'dynamic' },
  { from: 'src/lib/types.js', to: 'src/components/Button.js', kind: 'type' }, // ignored: type-only, ignore_kinds: [type]
  { from: 'scripts/build.js', to: 'src/app/page.js', kind: 'static' }, // ok: scripts/ is in no layer
  { from: 'src/features/billing/total.js', to: 'src/lib/a.js', kind: 'static' }, // ok, listed twice with two kinds
  { from: 'src/features/billing/total.js', to: 'src/lib/a.js', kind: 'type' },
];
