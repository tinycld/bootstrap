# @tinycld/create-package

Interactive scaffolder for `@tinycld` feature packages. One command produces a repo starter — manifest, CI workflow, lint/typecheck, sample screens, seed, migrations, and (optionally) a Go server — already wired to link into the [`tinycld`](https://github.com/tinycld/tinycld) app shell (which bundles `@tinycld/core`), use the `@tinycld/core/**` import convention, and pass its own CI.

Modeled after [`create-vite`](https://github.com/vitejs/vite/tree/main/packages/create-vite): tiny CLI, templates embedded in the published npm package, no runtime network fetch.

## Requirements

- **[npm](https://docs.npmjs.com/)** (recommended) on Node ≥ 24 (the package's `engines.node` is `>=24`; older Node may work but is unsupported).
- A local `tinycld/tinycld` (app shell) checkout as a sibling of the package you're scaffolding. The app shell bundles `@tinycld/core` at `packages/@tinycld/core/` — the scaffolded package's `tsconfig` extends `../tinycld/packages/@tinycld/core/tsconfig.json` and aliases `@tinycld/core/*` to `../tinycld/packages/@tinycld/core/*`. Linking is done from the app shell via `npm run packages:link`. **The scaffolder will offer to clone and link the app shell for you** — the linking step is interactive (or scripted via `--link` / `--no-link`).
- `git` + `gh` if you intend to use the suggested "initial push" next-step — both are optional.

## Usage

```sh
npx @tinycld/create-package my-feature
```

You'll be walked through an interactive prompt. The positional argument (`my-feature`) is the **slug** — kebab-case, 3–40 chars, becomes `@tinycld/my-feature`, the URL segment `/a/<orgSlug>/my-feature/`, and the Go module `tinycld.org/packages/my-feature`. Leave it off to be asked for it.

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
| **Link into the app shell?** | `y` / `n` | After scaffolding, the CLI offers to clone (or use existing) `tinycld` app shell, run `npm install` in it, and link this package. Suppress with `--no-link`. |

### Flags (non-interactive use)

Every prompt has a corresponding flag. Pass `--yes` (or `-y`) to accept all defaults and skip everything that wasn't given a flag — useful for scripted scaffolding.

| Flag | Maps to prompt | Notes |
|---|---|---|
| *(positional)* | Package slug | First non-flag argument. |
| `--name <s>` | Human-readable name | Defaults to title-cased slug. |
| `--description <s>` | Description | |
| `--preset <full\|settings-only>` | Preset | |
| `--icon <name>` | Lucide icon | Full preset only. |
| `--nav-order <n>` | Nav order | Integer 0–99. |
| `--shortcut <c>` | Keyboard shortcut | Single lowercase letter. |
| `--server` / `--no-server` | Include a Go server | Full preset only. |
| `--target <dir>` | Target directory | Default `./<slug>`. |
| `--link` / `--no-link` | Link into the app shell | Forces the post-scaffold link step on or off, skipping the prompt. |
| `--yes`, `-y` | — | Accept all defaults; with `--no-link`, fully non-interactive. |

Example, fully non-interactive:

```sh
npx @tinycld/create-package my-feature \
    --yes --no-link \
    --description "Tracks widgets across the org" \
    --preset full --icon box --nav-order 25 --shortcut w
```

`--help` is not wired (yet) — run `npx @tinycld/create-package` with no argv to discover prompts interactively.

## Presets

The scaffolder offers two starting points, corresponding to the two shapes already present in the tinycld ecosystem.

### `full` — data package

Matches the shape of `@tinycld/contacts`, `@tinycld/mail`, `@tinycld/calendar`, `@tinycld/drive`. You get routes, a sidebar, an optional provider, pbtsdb collections, PocketBase migrations, seed data, and a Go server stub.

<details>
<summary>Generated tree (with <code>slug=my-feature</code>)</summary>

```
my-feature/
├── .github/workflows/ci.yml           # lint + typecheck + unit tests; clones the tinycld app shell + links self
├── .gitignore                          # node_modules, *.tsbuildinfo, lockfiles, .DS_Store
├── README.md                           # developer-facing onboarding for this package
├── manifest.ts                         # name, slug, routes, nav, collections, seed, server, ...
├── package.json                        # @tinycld/my-feature, peer deps, scripts, exports map
├── tsconfig.json                       # extends ../tinycld/packages/@tinycld/core/tsconfig.json
├── pb-migrations/
│   └── 1800000000_create_my-feature.js # creates my_feature_items collection
├── server/
│   ├── go.mod                          # module tinycld.org/packages/my-feature; replaces tinycld.org/core → ../../tinycld/packages/@tinycld/core/server
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

The scaffolded `manifest.ts` is the single source of truth for what a package contributes. Templates only fill in the fields appropriate for the chosen preset; the full reference (every field, when to use it) lives in [`tinycld/tinycld`'s docs](https://github.com/tinycld/tinycld). Quick summary:

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

If you accepted the link-into-app-shell prompt, the package is already linked in `tinycld/`. Otherwise the CLI prints next-steps you can copy verbatim:

```sh
# 1. Initialize git and push to GitHub
cd my-feature
git init
git add .
git commit -m 'chore: initial scaffold'
gh repo create tinycld/my-feature --public --source=. --push

# 2. Link into the tinycld app shell so you can develop against it
cd ../tinycld
npm run packages:link ../my-feature

# 3. Verify (still inside tinycld/)
npm run checks
```

Once linked, the app shell's generator wires your manifest in automatically: routes appear at `/a/<orgSlug>/my-feature/**`, the sidebar renders, the settings panel shows up, migrations get picked up by PocketBase, etc. No further changes to `tinycld` or `core` are needed.

> ⚠️ **`tinycld/metro.config.cjs` scans `packages/` once at boot.** If you link a new package while `npm run start` is already running, restart it (Ctrl-C, then `npm run start`) so Metro's resolver picks it up. CI is fine — it always starts fresh.

### Day-to-day development

Most work happens **inside `tinycld/`** with your package linked. Run the app, make changes, see them live:

```sh
cd ../tinycld
npm run start        # expo + pocketbase, fronted by a single-port dev proxy
npm run checks       # biome + tsc — covers all linked packages including yours
npm run test:unit    # vitest, includes your tests/ via the packages glob
```

Hot reload picks up changes in your package the same way as core code, since it's symlinked.

### Running the scaffolded package's own CI locally

The package's `.github/workflows/ci.yml` reproduces the link-and-check dance locally. The shape:

1. Clone `tinycld/tinycld` as a sibling. (Core ships inside the app shell; no separate core clone needed.)
2. `npm install` inside `tinycld/` (this also runs the package generator via the postinstall hook).
3. `npm run packages:link ../<your-pkg>` from `tinycld/`.
4. **Lint from inside `tinycld/`** (`npm run lint`). Biome lives in the app shell and its config (`tinycld/biome.json`) is the single source of truth for every linked package. There is no `biome.json` in the package repo.
5. **Typecheck from inside `tinycld/`** (`npm run typecheck`) — the app shell's tsconfig pulls in `expo`'s base, `uniwind` global type augments (which add `className` to RN components), and the live `~/types/pbSchema` generated from PocketBase. A standalone `tsc` invocation inside the package can't see those.
6. Run unit tests from the package (vitest discovers them via the `packages/@*/*/tests/**` glob in `tinycld/vitest.config.ts`).

When you push, GitHub Actions runs that exact flow.

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
npm install
npm run dev my-feature --target /tmp/scratch       # tsx live-runs src/index.ts
npm run lint                                       # biome
npm run typecheck                                  # tsc --noEmit
npm run checks                                     # both of the above
npm run test                                       # vitest: substitute + validate + end-to-end scaffold into tmpdir
npm run build                                      # compile src/ → dist/ (what gets published)
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

`prepublishOnly` runs `npm run checks && npm run test && npm run build` before any publish, so a broken tree never reaches npm.

## Design notes

- **Templates are embedded in the npm package**, not fetched from a separate repo. `npx` grabs them once; scaffolding is offline thereafter.
- **Direct string replacement**, no handlebars / EJS. Simpler, fewer moving parts, no runtime template compiler.
- **No destructive actions**: the CLI refuses to overwrite a non-empty target directory and never touches git, gh, or your local repos without consent. The clone-and-link step is opt-in (`--link` / interactive prompt).
- **Two presets, not N flags**. We have exactly two shapes of feature package in the tinycld ecosystem today (data package, settings-only); offering a fine-grained matrix of "routes y/n, server y/n, …" adds prompt-fatigue with no real benefit.
- **`@clack/prompts`** for the interactive UX: smaller and nicer than inquirer. **`picocolors`** for output, no `chalk` weight.

## License

MIT.
