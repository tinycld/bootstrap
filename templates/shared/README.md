# {{PKG_SLUG}}

{{PKG_DESCRIPTION}}

A feature package for the [tinycld](https://tinycld.org/) ecosystem. It lives in
its own git repo and is developed as a **workspace member** alongside the app
shell (`app`), `@tinycld/core` (its own standalone repo, cloned as a sibling —
not bundled), and the other feature packages.

## Development

The package is one member of a tinycld workspace. To work on it you need a
workspace root containing at least `app`, `core`, and this package as siblings,
linked by a single `npm install` at the root.

```sh
# In a fresh workspace directory, clone this package into a member slot…
git clone git@github.com:tinycld/{{PKG_SLUG}}.git

# …then pull in the rest of the workspace tooling (app + core + the root
# package.json / lockfile). bootstrap --tooling skips dirs that already exist.
npx @tinycld/bootstrap@latest --tooling

# Link every member with one install at the WORKSPACE ROOT (never inside a
# member — siblings have no node_modules of their own; deps hoist to the root).
npm install

# Run the full stack (Expo + PocketBase, single-port dev proxy) from the app.
cd app
npm run dev
```

## Checks

All checks run **scoped to this member** through `tinycld-pkg`, which reuses the
app shell's biome config, tsconfig base, and vitest/playwright configs (so
`@tinycld/core/*`, uniwind augments, and PocketBase types all resolve):

```sh
cd {{PKG_SLUG}}
npx tinycld-pkg check       # biome + typecheck
npx tinycld-pkg test        # vitest unit tests
npx tinycld-pkg test:e2e    # playwright e2e specs (full preset only — packages with screens)
```

There is no `biome.json` in this repo — biome lives only in the app shell and
`tinycld-pkg` points it at this member's source.

## CI

`.github/workflows/ci.yml` runs typecheck, unit tests, and e2e on every push to
`main` and every PR. It checks out `tinycld/workspace` as the job root, drops
this PR's code into its member slot, assembles `app` + `core` via
`@tinycld/bootstrap --tooling`, installs at the workspace root, and runs
`tinycld-pkg check` / `tinycld-pkg test:e2e` — exactly what a developer runs
locally.

## Package anatomy

- `manifest.ts` — the single source of truth for this package's capabilities
- `package.json` — name, exports map, `tinycld-pkg` scripts, peer deps
- `tsconfig.json` — extends the app shell's package tsconfig base
- `vitest.config.ts` (and `playwright.config.ts` — full preset only) — thin configs spreading the app's
- `tinycld/{{PKG_SLUG}}/` — the package's TypeScript surface (screens, collections, …)
- `tests/` — vitest unit tests (and Playwright e2e specs — full preset only)
