# @agentreins/adapter-rails

The Ruby on Rails adapter of [**reins**](https://www.npmjs.com/package/@agentreins/cli): it reads which Ruby file depends on which, so `reins check` can enforce the architecture of a Rails app. With [Inertia](https://inertia-rails.dev), it also links each controller to the React, Vue or Svelte page it renders.

## Install

Install it next to the CLI, in the root of your Rails app (Node.js 22 or newer; **Ruby is not needed** to run it). A Rails app without a `package.json` needs one first (`npm init -y`).

```bash
npm install -D @agentreins/cli @agentreins/adapter-rails
# Rails + Inertia + React: add the JavaScript adapter too
# npm install -D @agentreins/cli @agentreins/adapter-rails @agentreins/adapter-js

npx reins install
npx reins init
```

`reins init` writes `adapters: [rails]` in `.reins/architecture.yml`. In an app with a Vite frontend (Inertia) and both adapters installed, it writes `adapters: [rails, js]` and drafts one plan for both: one baseline covers the Ruby code and the frontend.

## How it reads a Rails app

Ruby files don't import each other: Rails (Zeitwerk) loads a file the first time its constant is used. So a dependency is **"file A names a constant that file B defines"**.

```ruby
# app/controllers/orders_controller.rb
class OrdersController < ApplicationController   # → app/controllers/application_controller.rb
  def create
    Billing::Charge.new(Order.find(params[:id])) # → app/services/billing/charge.rb, app/models/order.rb
  end
end
```

- **Parses Ruby with [Prism](https://github.com/ruby/prism)**, the parser Ruby itself uses, shipped as WebAssembly. No Ruby, no gems and no booting the app.
- **Finds where every constant is defined** by reading the `class`, `module` and `CONSTANT =` definitions of every `.rb` and `.rake` file. It needs no naming convention, so files outside the autoload paths (`lib/`, initializers) work too.
- **Resolves references like Ruby does**: from the innermost enclosing module outwards (`Invoice` inside `module Billing` is `Billing::Invoice`), `::Absolute` names, and nested constants (`Billing::Invoice::STATUSES` belongs to the file of `Billing::Invoice`).
- **`require_relative` and `require`** of a file in the repo.
- **Associations** (edge kind `association`): `has_many :line_items` depends on `LineItem`, with `class_name:`, the model's namespace, and the acronyms and irregular plurals of `config/initializers/inflections.rb`.
- **Skips what is not yours**: constants of gems and of Ruby itself, `vendor/`, `tmp/`, `log/`, `storage/`, `public/`, `node_modules/`.
- **Entry points**: controllers, `config/`, `db/`, `spec/`, `test/`, `lib/tasks/`… are loaded by Rails itself, so they are never reported as orphans.
- **Preset `rails`** gives `reins init` a starting plan: layers `web` (controllers, channels, helpers) > `application` (services, jobs, mailers, policies, serializers…) > `models` > `lib`, and one domain per folder in `packs/`, `engines/` or `app/domains/` (Ruby has no index file, so a domain's public API starts as the files the rest of the app already uses). The code decides the final order, and what goes against it today is frozen in the baseline.

## Inertia

When the `Gemfile` has `inertia_rails`, each page a controller renders becomes an edge (kind `inertia`) from the controller to the page file:

| In Ruby | Page file |
| --- | --- |
| `render inertia: 'users/index', props: { … }` | `app/frontend/pages/users/index.tsx` |
| `render inertia: { user: }` in `Admin::UsersController#show` | `app/frontend/pages/admin/users/show.tsx` |
| `inertia 'dashboard' => 'Dashboard/Index'` in the routes | `app/frontend/pages/Dashboard/Index.tsx` |

Pages are looked up in `pages/` (or `Pages/`) under `app/frontend`, `app/javascript` or the `sourceCodeDir` of `config/vite.json`, as `.tsx`, `.jsx`, `.ts`, `.js`, `.vue` or `.svelte`. A rendered page that does not exist is a **warning**, never a silent gap.

With both adapters, `reins impact app/frontend/pages/users/show.tsx` lists the controller among the files that use the page, and layers can say which way the dependency may go.

## What it can't see

Static analysis of Ruby has limits, and it is better to know them:

- Anything found **by naming convention or at run time**: `constantize`, Pundit policies, serializers picked by name, `send`. Name the constant, or list those files as entry points in your own notes.
- **Views** (`.erb`, `.haml`, `.jbuilder`) are not read.
- Constants **inherited** from a superclass or an included module and used without their namespace.
- Inertia: `render inertia:` with a variable as the component, default rendering without a `render` call, and apps with a custom `component_path_resolver` (inferred names are skipped, with a warning).

## Learn more

- [Project site](https://fredarcito.github.io/reins/)
- [reins documentation](https://github.com/fredarcito/reins#readme)
- [Several languages in one repo](https://github.com/fredarcito/reins/blob/main/docs/architecture-yml.md#several-languages-in-one-repo)
- [Writing an adapter for another language](https://github.com/fredarcito/reins/blob/main/docs/adapter-contract.md)

## License

MIT
