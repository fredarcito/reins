import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import adapter from '@agentreins/adapter-rails';
import { validateEdges } from '@agentreins/core/contract';
import { resolveConstant } from '../src/graph.js';
import { camelize, singulars } from '../src/inflect.js';
import { inferredComponent } from '../src/inertia.js';

const fixture = (name) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
const app = fixture('inertia-app');
const g = await adapter.graph(app, {});
const targets = (from, kind) => g.edges.filter((e) => e.from === from && (!kind || e.kind === kind)).map((e) => e.to).sort();

test('detect: a Gemfile and config/application.rb', () => {
  assert.equal(adapter.detect(app), true);
  assert.equal(adapter.suggestPreset(app), 'rails');
  assert.equal(adapter.detect(fixture('.')), false);
  assert.equal(adapter.suggestPreset(fixture('.')), null);
});

test('graph: valid edges, Ruby files only, vendor skipped, entries from the preset', () => {
  assert.deepEqual(validateEdges(g.edges), []);
  assert.ok(g.files.includes('lib/tasks/billing.rake'));
  assert.ok(g.files.every((f) => /\.(rb|rake)$/.test(f)));
  assert.ok(!g.files.some((f) => f.startsWith('vendor/')));
  assert.ok(g.entries.includes('app/controllers/users_controller.rb') && g.entries.includes('config/routes.rb'));
  assert.ok(!g.entries.includes('app/models/user.rb'));
});

test('constants: superclass, include, nested constant, absolute and lexical lookups', () => {
  assert.deepEqual(targets('app/controllers/users_controller.rb', 'static'), [
    'app/controllers/application_controller.rb',
    'app/controllers/concerns/pageable.rb', // Pageable and Pageable::PER_PAGE: one edge
    'app/models/user.rb',
    'app/services/billing/charge.rb',
  ]);
  // Invoice inside `module Billing` is Billing::Invoice; ::User is absolute; Stripe::Charge is a gem
  assert.deepEqual(targets('app/services/billing/charge.rb'), ['app/models/billing/invoice.rb', 'app/models/user.rb']);
  // Billing::Invoice::STATUSES belongs to the file of Billing::Invoice, not to the namespace file
  assert.ok(targets('app/controllers/admin/reports_controller.rb', 'static').includes('app/models/billing/invoice.rb'));
  assert.ok(!targets('app/controllers/admin/reports_controller.rb').includes('app/models/billing.rb'));
  assert.deepEqual(targets('lib/tasks/billing.rake'), ['app/models/billing/invoice.rb', 'app/services/billing/charge.rb']);
});

test('constants: a reopened Ruby class is not a dependency; require and require_relative are', () => {
  assert.ok(!g.edges.some((e) => e.to === 'lib/core_ext/string.rb' && e.from.startsWith('app/')));
  assert.deepEqual(targets('config/application.rb'), ['config/boot.rb', 'lib/core_ext/string.rb']);
});

test('associations: plural, acronym and irregular names, class_name, namespace; polymorphic and unknown skipped', () => {
  assert.deepEqual(targets('app/models/user.rb', 'association'), ['app/models/billing/invoice.rb', 'app/models/criterion.rb', 'app/models/oauth_token.rb']);
  assert.deepEqual(targets('app/models/billing/invoice.rb', 'association'), ['app/models/billing/line_item.rb', 'app/models/user.rb']);
  assert.deepEqual(targets('app/models/billing/line_item.rb', 'association'), ['app/models/billing/invoice.rb']);
});

test('inertia: named, inferred and route components become edges to the page files', () => {
  assert.deepEqual(targets('app/controllers/users_controller.rb', 'inertia'), ['app/frontend/pages/users/index.tsx', 'app/frontend/pages/users/show.tsx']);
  assert.deepEqual(targets('app/controllers/admin/reports_controller.rb', 'inertia'), ['app/frontend/pages/admin/reports/show.tsx']);
  assert.deepEqual(targets('config/routes.rb', 'inertia'), ['app/frontend/pages/Dashboard/Index.tsx']);
});

test('inertia: a page that does not exist is a warning, never a silent gap', () => {
  assert.equal(g.warnings.length, 1);
  assert.match(g.warnings[0], /2 Inertia page\(s\) rendered from Ruby were not found under app\/frontend\/pages/);
  assert.match(g.warnings[0], /'users\/gone' in app\/controllers\/users_controller\.rb/);
  assert.match(g.warnings[0], /'Nowhere' in config\/routes\.rb/);
});

test('ignore globs drop files and the edges that reach them', async () => {
  const r = await adapter.graph(app, { ignore: ['app/models/billing/**'] });
  assert.ok(!r.files.includes('app/models/billing/invoice.rb'));
  assert.ok(!r.edges.some((e) => e.to.startsWith('app/models/billing/')));
});

test('a file with syntax errors is reported', async () => {
  const r = await adapter.graph(fixture('broken'), {});
  assert.match(r.warnings[0], /1 Ruby file\(s\) have syntax errors.*config\/application\.rb/);
});

test('resolveConstant: innermost scope first, longest owned name, namespaces without a file', () => {
  const known = new Set(['A', 'A::B', 'A::B::C', 'C', 'A::X']);
  const owners = new Map([['A::B::C', new Set(['abc.rb'])], ['C', new Set(['c.rb'])], ['A::X', new Set(['ax.rb'])]]);
  const one = (...a) => [...(resolveConstant(...a, known, owners) ?? [])];
  assert.deepEqual(one('C', ['A::B', 'A']), ['abc.rb']);
  assert.deepEqual(one('C', []), ['c.rb']);
  assert.deepEqual(one('X::DEFAULT', ['A::B', 'A']), ['ax.rb']);
  assert.deepEqual(one('B', ['A']), []); // A::B is only a namespace
  assert.deepEqual(one('Gem::Thing', ['A']), []);
});

test('inflector and inferred component names', () => {
  const inflections = { acronyms: new Map([['oauth', 'OAuth']]), irregulars: new Map([['criteria', 'criterion']]) };
  assert.equal(camelize('oauth_token', inflections), 'OAuthToken');
  assert.equal(camelize('admin/line_item', inflections), 'Admin::LineItem');
  assert.equal(singulars('line_items', inflections)[0], 'line_item');
  assert.equal(singulars('companies', inflections)[0], 'company');
  assert.equal(singulars('search_criteria', inflections)[0], 'search_criterion');
  assert.ok(singulars('addresses', inflections).includes('address'));
  assert.ok(singulars('statuses', inflections).includes('status'));
  assert.equal(inferredComponent('app/controllers/admin/users_controller.rb', 'show'), 'admin/users/show');
  assert.equal(inferredComponent('packs/billing/app/controllers/invoices_controller.rb', 'index'), 'invoices/index');
  assert.equal(inferredComponent('app/services/x.rb', 'call'), null);
});
