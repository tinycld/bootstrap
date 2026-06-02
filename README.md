# @tinycld/bootstrap

`@tinycld/bootstrap` does two jobs:

- **`--new <slug>`** — scaffold a new feature package (manifest, CI workflow, sample screens, seed, migrations, optionally a Go server).
- **`--assemble-only`** — assemble a workspace root in the current directory by cloning the [`app`](https://github.com/tinycld/app) shell, the [`core`](https://github.com/tinycld/core) library, and any features named with `--with <slug>`.

Modeled after [`create-vite`](https://github.com/vitejs/vite/tree/main/packages/create-vite): tiny CLI, templates embedded in the published npm package, no runtime network fetch.

## Requirements

- **[npm](https://docs.npmjs.com/)** on Node ≥ 24 (the package's `engines.node` is `>=24`; older Node may work but is unsupported).
- `git` (always) and `gh` (only for the suggested "initial push" next-step) on `$PATH`.

The two modes are independent — scaffold mode does not require a pre-existing workspace, and assemble mode does not require a scaffolded package. They compose: a common flow is `--assemble-only` once to set up `~/code/tinycld/`, then `--new <slug>` from inside that workspace to add a feature.

## Assemble a workspace (`--assemble-only`)

```sh
mkdir ~/code/tinycld && cd ~/code/tinycld
npx @tinycld/bootstrap@latest --assemble-only --with mail --with contacts
pnpm install                  # links members + runs the generator (postinstall)
cd app && pnpm run dev
```

The CLI writes the workspace coordination files (`package.json`, `tinycld.packages.ts`, `vitest.config.ts`, shared test stubs, the `package-scripts/` CLI) from embedded templates, then clones `app` + `core` as siblings. Each `--with <slug>` adds one feature sibling. `app` and `core` are always cloned; everything else is opt-in.

`--with name@ref` pins a clone to a tag, branch, or commit:

```sh
npx @tinycld/bootstrap@latest --assemble-only \
    --with app@v1.2.0 --with core@v1.2.0 --with mail@v0.3.1
```

Skipped if the target directory already exists, so re-running is safe.

Set `TINYCLD_REPO_BASE` to clone over HTTPS instead of the default SSH (`git@github.com:tinycld`). CI uses this:

```sh
TINYCLD_REPO_BASE=https://github.com/tinycld \
    npx @tinycld/bootstrap@latest --assemble-only --with mail
```

## Scaffold a new package (`--new`)

```sh
npx @tinycld/bootstrap --new my-feature
```

You'll be walked through an interactive prompt. The positional argument (`my-feature`) is the **slug** — kebab-case, 3–40 chars, becomes `@tinycld/my-feature`, the URL segment `/a/<orgSlug>/my-feature/`, and the Go module `tinycld.org/packages/my-feature`. Leave it off to be asked for it.

If `--new` runs from inside an existing workspace root (`app/` and `core/` siblings detected), the new package is scaffolded as a sibling and the link step adds it to the workspace `package.json`. Otherwise the CLI creates a wrapper directory `./tinycld-<slug>/` with the package at `./tinycld-<slug>/<slug>/`, assembles a workspace around it (cloning `app` + `core`), and links — leaving you a self-contained, runnable workspace.

### Prompts

| Prompt | Example | Notes |
|---|---|---|
| **Package slug** | `my-feature` | Skipped if given as argv. Validates kebab-case, minimum 3 chars. |
| **Human-readable name** | `My Feature` | Defaults to title-cased slug; used in the manifest's `name` + nav label. |
| **One-sentence description** | `Does a thing well.` | Used in manifest `description`, package.json, and README. |
| **Preset** | `full` / `settings-only` | See below. |
| **Lucide icon name** (full only) | `box` | Any [lucide-react-native](https://lucide.dev/icons) name. Default `box`. |
| **Nav order** (full only) | `20` | Integer 0–99, controls sidebar position. |
| **Keyboard shortcut** (full only) | `f` | Single lowercase letter, or blank. |
| **Include a Go server?** (full only) | `y` / `n` | If no, `server/` and the manifest's `server` field are omitted. |
| **Target directory** | `./my-feature` | Default creates the new repo as a child of the current directory. Must not exist or must be empty. |
| **Link into the workspace?** | `y` / `n` | After scaffolding, the CLI adds the package to `pnpm-workspace.yaml`'s `packages:` list (and the `package.json` `workspaces` hint) and runs `pnpm install` at the workspace root. If cwd isn't a workspace root, it assembles one (cloning `app` + `core`) first. Suppress with `--no-link`. |

### Flags (non-interactive use)

Every prompt has a corresponding flag. Pass `--yes` (or `-y`) to accept all defaults and skip everything that wasn't given a flag — useful for scripted scaffolding.

| Flag | Maps to | Notes |
|---|---|---|
| `--new` | Mode selector | Required for scaffold mode. Mutually exclusive with `--assemble-only`. |
| `--assemble-only` | Mode selector | Required for workspace-assembly mode. Mutually exclusive with `--new`. |
| `--with <slug>` | Assemble-only | Repeatable. Each adds one feature sibling. Accepts `--with name@ref` to pin to a tag/branch/commit. |
| *(positional)* | Package slug (scaffold) | First non-flag argument. Pair with `--new` to set the slug non-interactively. |
| `--name <s>` | Human-readable name | Defaults to title-cased slug. |
| `--description <s>` | Description | |
| `--preset <full\|settings-only>` | Preset | |
| `--icon <name>` | Lucide icon | Full preset only. |
| `--nav-order <n>` | Nav order | Integer 0–99. |
| `--shortcut <c>` | Keyboard shortcut | Single lowercase letter. |
| `--server` / `--no-server` | Include a Go server | Full preset only. |
| `--target <dir>` | Target directory | Default `./<slug>`. |
| `--link` / `--no-link` | Link into the workspace | Forces the post-scaffold link step on or off, skipping the prompt. |
| `--yes`, `-y` | — | Accept all defaults; with `--no-link`, fully non-interactive. |

Example, fully non-interactive:

```sh
npx @tinycld/bootstrap --new my-feature \
    --yes --no-link \
    --description "Tracks widgets across the org" \
    --preset full --icon box --nav-order 25 --shortcut w
```

`--help` is not wired (yet) — run `npx @tinycld/bootstrap` with no argv to get a usage summary listing both modes.

## Presets

The scaffolder offers two starting points, corresponding to the two shapes already present in the tinycld ecosystem.

### `full` — data package

Matches the shape of `@tinycld/contacts`, `@tinycld/mail`, `@tinycld/calendar`, `@tinycld/drive`. You get routes, a sidebar, an optional provider, pbtsdb collections, PocketBase migrations, seed data, and a Go server stub.

<details>
<summary>Generated tree (with <code>slug=my-feature</code>)</summary>

```
my-feature/
├── .github/workflows/ci.yml           # assembles the workspace via bootstrap --assemble-only, runs tinycld-pkg check + test:e2e
├── .gitignore                          # node_modules, *.tsbuildinfo, lockfiles, .DS_Store
├── README.md                           # developer-facing onboarding for this package
├── manifest.ts                         # name, slug, routes, nav, collections, seed, server, ...
├── package.json                        # @tinycld/my-feature, peer deps, scripts, exports map
├── tsconfig.json                       # extends ../app/tsconfig.package-base.json
├── pb-migrations/
│   └── 1800000000_create_my-feature.js # creates my_feature_items collection
├── server/
│   ├── go.mod                          # module tinycld.org/packages/my-feature; replaces tinycld.org/core → ../../core/server
│   └── register.go                     # func Register(app) hook for server-side wiring
├── tests/
│   └── manifest.test.ts                # vitest smoke test of manifest shape
└── tinycld/my-feature/                 # all package TypeScript lives under this prefix
    ├── collections.ts                  # registerCollections() for pbtsdb
    ├── provider.tsx                    # optional context provider
    ├── seed.ts                         # default-export async seed(pb, ctx)
    ├── sidebar.tsx                     # sidebar rendered for this package's routes
    ├── types.ts                        # MyFeatureSchema + record interfaces
    └── screens/
        ├── _layout.tsx                 # Stack layout for /a/[orgSlug]/my-feature/**
        ├── [id].tsx                    # detail route
        └── index.tsx                   # list route
```

</details>

The `tinycld/my-feature/` nesting gives the package a stable public API surface accessible via the `package.json` `exports` map: `@tinycld/my-feature/screens/*`, `/sidebar`, `/collections`, etc.

### `settings-only` — service package

Matches `@tinycld/google-takeout-import`. The package contributes only a settings panel — no routes, no nav entry, no collections, no server. Use this for integrations or admin-style tools that live under `/a/<orgSlug>/settings/**`.

<details>
<summary>Generated tree</summary>

```
my-service/
├── .github/workflows/ci.yml
├── .gitignore
├── README.md
├── manifest.ts                         # name, slug, description, settings[] only
├── package.json
├── tsconfig.json
├── tests/
│   └── manifest.test.ts
└── tinycld/my-service/
    ├── types.ts                        # public type exports (empty by default)
    └── settings/
        └── main.tsx                    # the settings panel component
```

</details>

## Manifest fields

The scaffolded `manifest.ts` is the single source of truth for what a package contributes. Templates only fill in the fields appropriate for the chosen preset; the full reference (every field, when to use it) lives in the [manifest schema docs](https://tinycld.org/docs/reference/manifest-schema). Quick summary:

| Field | Meaning |
|---|---|
| `name`, `slug`, `version`, `description` | Identity. `slug` is the URL segment and the npm name's last segment. |
| `routes.directory` | Subpath (resolved through `package.json` exports) where org-scoped screens live. Generator re-exports each screen file under `app/a/[orgSlug]/<slug>/`. |
| `nav` | `{ label, icon, order, shortcut }` — sidebar entry for the org workspace. |
| `sidebar.component` | Subpath to the package's sidebar component, rendered when on its routes. |
| `provider.component` | Optional context provider mounted around the package's routes. |
| `migrations.directory` | Folder of PocketBase JS migrations; symlinked into the app shell. |
| `collections.register`, `collections.types` | Subpaths to the pbtsdb registration function and the schema types. |
| `seed.script` | Default-export async function called by the dev seeder for this package. |
| `server` | `{ package, module }` — relative dir + Go module path for the optional server extension. |
| `settings[]` | One entry per panel contributed under `/a/<orgSlug>/settings/<slug>`. |

All path-shaped fields use **short subpaths** (`'screens'`, `'sidebar'`, `'collections'`) that match the keys in `package.json`'s `exports` map — the generator follows the exports map to find the actual files under `tinycld/<slug>/...`.

## After scaffolding

If you accepted the link-into-workspace prompt, the package is already a workspace member and `pnpm install` has run. Otherwise the CLI prints next-steps you can copy verbatim:

```sh
# 1. Initialize git and push to GitHub
cd my-feature
git init
git add .
git commit -m 'chore: initial scaffold'
gh repo create tinycld/my-feature --public --source=. --push

# 2. Link into the workspace (add as a member, then install)
cd ..
# ensure "my-feature" is listed in pnpm-workspace.yaml's "packages:" list, then:
pnpm install

# 3. Verify (scoped to this member)
cd my-feature
pnpm exec tinycld-pkg check
```

Once linked, the app shell's generator wires your manifest in automatically: routes appear at `/a/<orgSlug>/my-feature/**`, the sidebar renders, the settings panel shows up, migrations get picked up by PocketBase. No further changes to `app/` or `core/` are needed.

> ⚠️ **`app/metro.config.cjs` watches the workspace root**, but Expo's resolver caches package metadata at boot. If you add a new sibling while `pnpm run dev` is already running, restart it (Ctrl-C, then `pnpm run dev`) so the new member is picked up. CI is fine — it always starts fresh.

### Day-to-day development

Most work happens **from inside the package** with the workspace assembled around it:

```sh
cd my-feature
pnpm exec tinycld-pkg check        # biome + tsc + vitest, scoped to this member
pnpm exec tinycld-pkg test         # vitest only
pnpm exec tinycld-pkg test:e2e     # playwright for this member
```

To run the app itself, drop into the app shell:

```sh
cd ../app
pnpm run dev                  # expo + pocketbase, fronted by a single-port dev proxy
pnpm run checks               # biome + tsc, ecosystem-wide
```

Hot reload picks up changes in your package the same way as core code, since members are symlinked.

### Running the scaffolded package's own CI locally

The package's `.github/workflows/ci.yml` mirrors what GitHub Actions runs:

1. Assemble a workspace via `npx @tinycld/bootstrap --assemble-only`. The job has `--with <this-pkg>@<sha>` so it lands the exact commit under test.
2. `pnpm install` at the workspace root (this also runs the package generator via the postinstall hook).
3. `pnpm exec tinycld-pkg check` from inside the package directory — runs biome (scoped), tsc, and vitest.
4. `pnpm exec tinycld-pkg test:e2e` if the package ships Playwright specs under `tests/`.

Biome lives only in `app/biome.json` (one config across every member). There is no `biome.json` in the scaffolded package repo. Typecheck runs against the app shell's tsconfig via `tinycld-pkg`, so the `expo` base, `uniwind` global augments, and the live `pbSchema` types are all in scope.

## Import conventions the templates assume

Sibling packages should import core utilities via the **scoped** path:

```ts
// ✓ right
import { useOrgLiveQuery } from '@tinycld/core/lib/use-org-live-query'
import { useThemeColor } from '@tinycld/core/lib/use-app-theme'
import { Modal } from '@tinycld/core/ui/modal'

// ✗ wrong (legacy; resolved in earlier core layouts but not the current one)
import { useOrgLiveQuery } from '~/lib/use-org-live-query'
```

Within the package, intra-package imports use relative paths:

```ts
import { registerCollections } from './collections'
import { ContactForm } from '../components/ContactForm'
```

`~/tinycld/<slug>/*` is also aliased to your own nested source, for cases where you want an absolute import within the package — but relative paths are usually clearer.

Cross-package dependencies are **not** supported at compile time. If your package needs data from another package (e.g. mail wanting to read contacts), use the runtime `usePackages()` helper from `@tinycld/core/lib/packages/use-packages` and do the lookup at runtime. See `mail/tinycld/mail/components/ContactSuggestionsList.tsx` or `drive/tinycld/drive/components/ContactSuggestionsSource.tsx` for the canonical pattern.

## Contributing to the templates

Templates live under `templates/`:

```
templates/
├── shared/             # files identical across presets (tsconfig, CI workflow, README, .gitignore, tests/manifest.test.ts)
├── full/               # data-package preset (manifest, package.json, screens, sidebar, provider, collections, types, seed, pb-migrations, server)
└── settings-only/      # settings-only preset (manifest, package.json, types, settings/main.tsx)
```

`shared/` is copied first; the selected preset is copied on top. A preset can override a shared file just by naming it at the same relative path. After copying, if `--no-server` was chosen, `server/` is removed and the `server: { … }` field is stripped from `manifest.ts`.

Files contain `{{PLACEHOLDER}}` tokens that get substituted at scaffold time:

| Placeholder | Derivation |
|---|---|
| `{{PKG_SLUG}}` | user input, kebab-case |
| `{{PKG_NAME}}` | user input, human-readable |
| `{{PKG_SCOPED}}` | kept as alias for `{{PKG_SLUG}}` (back-compat; prefer `{{PKG_SLUG}}` in new templates) |
| `{{PKG_PASCAL}}` | PascalCase of slug |
| `{{PKG_CAMEL}}` | camelCase of slug |
| `{{PKG_SNAKE}}` | snake_case of slug (for DB table names) |
| `{{PKG_DESCRIPTION}}` | user input |
| `{{PKG_ICON}}` | user input, lucide icon name |
| `{{PKG_NAV_ORDER}}` | user input, integer |
| `{{PKG_NAV_SHORTCUT}}` | user input, single letter or empty |
| `{{GO_MODULE}}` | `tinycld.org/packages/` + slug |

Substitution runs on both file **content** and **file/directory names** — that's how `tinycld/{{PKG_SLUG}}/**` becomes `tinycld/my-feature/**`. Binary files (`.png`, `.jpg`, `.woff`, etc) are copied byte-for-byte and skipped during substitution; the full list lives in `BINARY_EXTENSIONS` in `src/copy-template.ts`.

Adding a new placeholder requires one line in `src/substitute.ts`'s `buildPlaceholders()` plus whatever tokens you scatter through the templates.

### Local development of the scaffolder itself

```sh
pnpm install
pnpm run dev my-feature --target /tmp/scratch       # tsx live-runs src/index.ts
pnpm run lint                                       # biome
pnpm run typecheck                                  # tsc --noEmit
pnpm run checks                                     # both of the above
pnpm run test                                       # vitest: substitute + validate + end-to-end scaffold into tmpdir
pnpm run build                                      # compile src/ → dist/ (what gets published)
```

The scaffolder tests invoke `copyTemplate` into a tmp directory and assert the expected tree, file contents, and placeholder substitutions for both presets. The end-to-end flow (link into a real `tinycld/` checkout and boot the dev server) is covered manually — see git history for the validation playbook.

## Publishing

The repo's `.github/workflows/ci.yml` has a `publish` job that runs on tag pushes (`v*`). Tag a release and it ships to npm under the `@tinycld` scope:

```sh
# Bump version in package.json, commit, then
git tag v0.1.1
git push --tags
```

Publishing needs an `NPM_TOKEN` repo secret (npm "automation" token scoped to `@tinycld`). Add it once at Settings → Secrets → Actions.

`prepublishOnly` runs `pnpm run checks && pnpm run test && pnpm run build` before any publish, so a broken tree never reaches npm.

## Design notes

- **Templates are embedded in the npm package**, not fetched from a separate repo. `npx` grabs them once; scaffolding is offline thereafter.
- **Direct string replacement**, no handlebars / EJS. Simpler, fewer moving parts, no runtime template compiler.
- **No destructive actions**: the CLI refuses to overwrite a non-empty target directory and never touches git, gh, or your local repos without consent. The clone-and-link step is opt-in (`--link` / interactive prompt).
- **Two presets, not N flags**. We have exactly two shapes of feature package in the tinycld ecosystem today (data package, settings-only); offering a fine-grained matrix of "routes y/n, server y/n, …" adds prompt-fatigue with no real benefit.
- **`@clack/prompts`** for the interactive UX: smaller and nicer than inquirer. **`picocolors`** for output, no `chalk` weight.

## License

MIT.
