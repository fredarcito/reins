// End to end with the real Rails adapter: init on a Rails app, and a Rails + Inertia + React repo checked with both adapters.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { guessAdapterNames } from '../src/adapter.js';
import { cli, tempDir } from './helpers.js';

const RAILS = {
  Gemfile: "gem 'rails'\n",
  'config/application.rb': 'module Shop\n  class Application < Rails::Application\n  end\nend\n',
  'app/controllers/application_controller.rb': 'class ApplicationController < ActionController::Base\nend\n',
  'app/controllers/users_controller.rb': "class UsersController < ApplicationController\n  def show\n    render inertia: { user: User.find(params[:id]) }\n  end\nend\n",
  'app/services/signup.rb': 'class Signup\n  def call\n    User.create!\n  end\nend\n',
  'app/models/user.rb': 'class User < ApplicationRecord\n  after_create { Signup.new }\nend\n',
  'app/models/application_record.rb': 'class ApplicationRecord < ActiveRecord::Base\nend\n',
};
const FRONTEND = {
  Gemfile: "gem 'rails'\ngem 'inertia_rails'\n",
  'package.json': { name: 'shop', type: 'module' },
  'vite.config.js': 'export default {};\n',
  'app/frontend/pages/users/show.jsx': "import { Avatar } from '../../components/Avatar.jsx';\nexport default function Show() { return Avatar; }\n",
  'app/frontend/components/Avatar.jsx': 'export const Avatar = null;\n',
};

test('a Rails repo is guessed as rails first, then js when it has a package.json', () => {
  assert.deepEqual(guessAdapterNames(tempDir(RAILS)), ['rails']);
  assert.deepEqual(guessAdapterNames(tempDir({ ...RAILS, ...FRONTEND })), ['rails', 'js']);
  assert.deepEqual(guessAdapterNames(tempDir(FRONTEND)), ['js']);
  assert.deepEqual(guessAdapterNames(tempDir({ Gemfile: '' })), []);
});

test('rails + inertia: init drafts one plan for both adapters, with controllers above the pages they render', async () => {
  const dir = tempDir({
    ...RAILS,
    ...FRONTEND,
    'app/frontend/entrypoints/application.js': "import '../components/Avatar.jsx';\n",
    'app/frontend/pages/users/index.jsx': "import { Avatar } from '../../components/Avatar.jsx';\nexport default function Index() { return Avatar; }\n",
  });
  const r = await cli(dir, ['init']);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const yml = readFileSync(path.join(dir, '.reins/architecture.yml'), 'utf8');
  assert.match(yml, /^adapters: \[rails, js\]$/m);
  assert.doesNotMatch(yml, /^preset:/m);
  assert.match(yml, /name: pages, paths: \["app\/\{frontend,javascript\}\/\{pages,Pages\}\/\*\*"/);
  // in a pages folder index.jsx is a page, not a barrel: every page is public, so the controller may render show.jsx
  assert.match(yml, /users: \{ paths: \["app\/frontend\/pages\/users\/\*\*"\], public_api: \["app\/frontend\/pages\/users\/index\.jsx", "app\/frontend\/pages\/users\/show\.jsx"\] \}/);
  assert.match(r.stdout, /Layers: web > application > models > pages > components/);
  assert.match(r.stdout, /Domains \(one per route folder\): users/);
  const report = readFileSync(path.join(dir, '.reins/init-report.md'), 'utf8');
  assert.match(report, /Adapters: `@agentreins\/adapter-rails`, preset `rails` \(detected\); `@agentreins\/adapter-js`, preset `inertia-react` \(detected\)/);
  assert.doesNotMatch(report, /`app\/frontend\/pages\/users\/index\.jsx`\n/, 'a page no controller renders yet is still an entry point');
  const check = await cli(dir, ['check']);
  assert.equal(check.code, 0, check.stdout + check.stderr);
});

test('a Rails API whose package.json only holds tooling stays rails-only', async () => {
  const dir = tempDir({ ...RAILS, 'package.json': { name: 'api' } });
  const r = await cli(dir, ['init']);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  assert.match(readFileSync(path.join(dir, '.reins/architecture.yml'), 'utf8'), /^adapters: \[rails\]\npreset: rails$/m);
});

test('rails: init drafts the plan from the preset and check passes right after', async () => {
  const dir = tempDir(RAILS);
  const r = await cli(dir, ['init']);
  assert.equal(r.code, 0, r.stderr + r.stdout);
  const yml = readFileSync(path.join(dir, '.reins/architecture.yml'), 'utf8');
  assert.match(yml, /^adapters: \[rails\]$/m);
  assert.match(yml, /app\/controllers\/\*\*/);
  assert.match(yml, /app\/models\/\*\*/);
  assert.match(r.stdout, /Layers: web > application > models/);
  // User uses Signup and Signup uses User: against the layers and a cycle, both frozen in the baseline, not a failure
  assert.match(r.stdout, /2 existing violations frozen/);
  assert.doesNotMatch(r.stdout, /Warnings/);
  const check = await cli(dir, ['check']);
  assert.equal(check.code, 0, check.stdout + check.stderr);
});

test('rails + js: a controller that renders an Inertia page depends on the page file', async () => {
  const dir = tempDir({
    ...RAILS,
    ...FRONTEND,
    '.reins/architecture.yml': [
      'version: 1',
      'adapters: [js, rails]',
      'layers:',
      '  - { name: frontend, paths: ["app/frontend/**"] }',
      '  - { name: backend, paths: ["app/controllers/**", "app/models/**", "app/services/**"] }',
      'rules:',
      '  - { id: layer-direction, severity: error }',
      'allow: []',
      '',
    ].join('\n'),
  });
  // the backend layer sits below the frontend here, so the controller -> page edge is the violation that proves it exists
  const check = await cli(dir, ['check']);
  assert.equal(check.code, 1, check.stdout + check.stderr);
  assert.match(check.stdout, /app\/controllers\/users_controller\.rb → app\/frontend\/pages\/users\/show\.jsx/);
  const impact = await cli(dir, ['impact', 'app/frontend/pages/users/show.jsx']);
  assert.match(impact.stdout, /Imported by: 1 file/);
});
