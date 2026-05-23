import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// All feature members that exist in the ecosystem. The workspace manifest lists
// ALL of them (npm tolerates absent dirs), so a partial checkout still installs.
// But --tooling CLONES only app+core+requested — we do NOT force-clone all.
const ALL_FEATURES = ['contacts', 'mail', 'calendar', 'drive', 'calc', 'text', 'google-takeout-import'] as const

// app + core are always cloned by tooling mode (the minimum viable workspace);
// the clone set in bootstrapTooling seeds them directly (pinnable via
// appRef/coreRef). package-scripts (the tinycld-pkg CLI) now lives INSIDE the
// app member at app/package-scripts, so it arrives with the app clone and is
// never cloned separately.

// Listed in the manifest workspaces array (everything that could exist). The
// nested member path app/package-scripts is a valid npm workspace entry.
const ALL_MEMBERS = ['app', 'app/package-scripts', 'core', ...ALL_FEATURES] as const

/**
 * Write (or merge into) a workspace-root package.json + .npmrc in `dir`.
 *
 * When `dir/package.json` already exists (e.g. provided by the workspace clone),
 * we preserve its fields and only enforce the two things bootstrap owns:
 * the complete `workspaces` list (so later --with clones need no manifest edit)
 * and the `postinstall` script. All other fields — devDependencies, engines,
 * volta, extra scripts, etc. — survive as-is.
 *
 * When no package.json exists yet (workspace clone was skipped), the full
 * generated defaults are written, matching the previous behaviour.
 *
 * The workspaces array ALWAYS lists every possible member — npm ignores entries
 * whose dirs are absent, so a partial checkout installs fine.
 *
 * .npmrc is written only when one does not already exist, for the same reason.
 */
export function writeWorkspaceManifest(dir: string): void {
    const pkgPath = join(dir, 'package.json')
    let existing: Record<string, unknown> = {}
    if (existsSync(pkgPath)) {
        try {
            existing = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        } catch {
            // Unparseable existing file — start from defaults
        }
    }

    const existingScripts =
        typeof existing.scripts === 'object' && existing.scripts !== null
            ? (existing.scripts as Record<string, string>)
            : {}

    const pkg = {
        name: '@tinycld/workspace',
        version: '0.0.0',
        private: true,
        type: 'module',
        ...existing,
        // Always enforce the canonical workspaces list and postinstall script.
        workspaces: [...ALL_MEMBERS],
        scripts: {
            ...existingScripts,
            postinstall: 'cd app && npm run packages:generate && npm run assets:copy-pdfjs',
        },
    }
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)

    const npmrcPath = join(dir, '.npmrc')
    if (!existsSync(npmrcPath)) {
        writeFileSync(npmrcPath, 'legacy-peer-deps=true\n')
    }
}

/**
 * Resolve the workspace-template dir relative to this module. Published builds
 * have `dist/bootstrap-tooling.js` next to `templates/`; dev has
 * `src/bootstrap-tooling.ts` under the same parent. Both → `../templates/workspace`.
 */
function resolveWorkspaceTemplateDir(): string {
    const here = dirname(fileURLToPath(import.meta.url))
    return join(here, '..', 'templates', 'workspace')
}

/**
 * Copy the workspace-root scaffolding (tinycld.packages.ts, vitest.config.ts,
 * tests/ stubs) from bootstrap's templates/workspace/ into `dir`. These files
 * are pure scaffolding the workspace ROOT needs but that no longer lives in a
 * committed workspace repo — bootstrap is their source of truth.
 *
 * Never overwrites an existing file: a real workspace checkout, or a CI lane
 * that supplied its own copy, keeps what it has (same non-destructive ethos as
 * the member clones). Returns the relative paths actually written.
 */
export function copyWorkspaceTemplate(dir: string, templateDir = resolveWorkspaceTemplateDir()): string[] {
    if (!existsSync(templateDir)) return []
    const written: string[] = []
    const walk = (src: string): void => {
        for (const entry of readdirSync(src)) {
            const srcPath = join(src, entry)
            const rel = relative(templateDir, srcPath)
            const dstPath = join(dir, rel)
            if (statSync(srcPath).isDirectory()) {
                walk(srcPath)
                continue
            }
            if (existsSync(dstPath)) continue // never overwrite
            mkdirSync(dirname(dstPath), { recursive: true })
            cpSync(srcPath, dstPath)
            written.push(rel)
        }
    }
    walk(templateDir)
    return written
}

export interface BootstrapToolingOptions {
    /** Directory to assemble the workspace in (becomes the workspace root). */
    root: string
    /**
     * Feature members to clone IN ADDITION to app+core. Defaults to NONE — the
     * whole point is a minimal checkout. Pass slugs via --with on the CLI. Each
     * entry may carry a pinned ref as `<name>@<ref>` (e.g. `contacts@v1.2.3`) to
     * clone that exact tag/branch instead of the default HEAD of main.
     */
    members?: readonly string[]
    /** git base, e.g. git@github.com:tinycld. */
    repoBase?: string
    /** Pin the always-cloned `app` member to this ref (tag/branch). Default HEAD. */
    appRef?: string
    /** Pin the always-cloned `core` member to this ref (tag/branch). Default HEAD. */
    coreRef?: string
    /** Injected for tests; defaults to real git clone. `ref` pins the checkout. */
    clone?: (url: string, dest: string, ref?: string) => boolean
}

/** Split a member spec `name@ref` into its parts. No `@` → no ref (clone HEAD). */
function splitRef(spec: string): { name: string; ref?: string } {
    const at = spec.indexOf('@')
    if (at === -1) return { name: spec }
    return { name: spec.slice(0, at), ref: spec.slice(at + 1) || undefined }
}

function realClone(url: string, dest: string, ref?: string): boolean {
    const args = ['clone', '--depth', '1']
    if (ref) args.push('--branch', ref)
    args.push(url, dest)
    const r = spawnSync('git', args, { stdio: 'inherit' })
    return r.status === 0
}

/**
 * Assemble a workspace skeleton at opts.root: write the canonical root manifest
 * (writeWorkspaceManifest) + lay down the root scaffolding (copyWorkspaceTemplate:
 * tinycld.packages.ts, vitest.config.ts, tests/ stubs, version files), then clone
 * ONLY app + core + the explicitly-requested feature members (skipping any
 * already present — e.g. a CI-checked-out member). There is NO workspace
 * meta-repo clone: bootstrap is the source of all root scaffolding.
 * Unknown member names throw. Returns the members that ended up present. Does
 * NOT run npm install (the caller / CI controls that, since it may want a
 * clean `npm ci`).
 */
export function bootstrapTooling(opts: BootstrapToolingOptions): string[] {
    // Each requested member may be `name` or `name@ref`. Validate the NAME part.
    const requested = (opts.members ?? []).map(splitRef)
    const unknown = requested.filter((m) => !ALL_FEATURES.includes(m.name as (typeof ALL_FEATURES)[number]))
    if (unknown.length > 0) {
        throw new Error(
            `Unknown feature member(s): ${unknown.map((m) => m.name).join(', ')}. Known: ${ALL_FEATURES.join(', ')}`
        )
    }
    const repoBase = opts.repoBase ?? 'git@github.com:tinycld'
    const clone = opts.clone ?? realClone

    const present: string[] = []

    // Write the canonical root manifest (workspaces list + postinstall), then
    // lay down the root scaffolding bootstrap owns (tinycld.packages.ts,
    // vitest.config.ts, tests/ stubs, .node-version, .go-version). Both are
    // non-destructive: anything already present (a real workspace checkout, or
    // a CI lane that supplied its own) is left as-is.
    writeWorkspaceManifest(opts.root)
    copyWorkspaceTemplate(opts.root)

    // Build the clone set keyed by member NAME so a member passed both bare and
    // with an @ref dedupes to one clone (the ref-bearing entry wins). app+core
    // are always cloned and pinnable via appRef/coreRef.
    const refByName = new Map<string, string | undefined>()
    refByName.set('app', opts.appRef)
    refByName.set('core', opts.coreRef)
    for (const { name, ref } of requested) {
        // A later ref overrides an earlier bare entry; a bare entry never clears
        // an existing ref.
        if (ref !== undefined || !refByName.has(name)) refByName.set(name, ref)
    }

    for (const [name, ref] of refByName) {
        const dest = join(opts.root, name)
        if (existsSync(join(dest, '.git')) || existsSync(join(dest, 'package.json'))) {
            present.push(name)
            continue
        }
        if (clone(`${repoBase}/${name}.git`, dest, ref)) present.push(name)
    }
    return present
}
