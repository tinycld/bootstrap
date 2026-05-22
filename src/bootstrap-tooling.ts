import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { looksLikeWorkspaceRoot } from './layout.ts'

// All feature members that exist in the ecosystem. The workspace manifest lists
// ALL of them (npm tolerates absent dirs), so a partial checkout still installs.
// But --tooling CLONES only app+core+requested — we do NOT force-clone all.
const ALL_FEATURES = ['contacts', 'mail', 'calendar', 'drive', 'calc', 'text', 'google-takeout-import'] as const

// app + core are always cloned by tooling mode (the minimum viable workspace);
// the clone set in bootstrapTooling seeds them directly (pinnable via
// appRef/coreRef). package-scripts ships inside the workspace meta-repo itself,
// so it is never cloned.

// Listed in the manifest workspaces array (everything that could exist).
const ALL_MEMBERS = ['app', 'core', 'package-scripts', ...ALL_FEATURES] as const

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
 * Clone the workspace meta-repo into `root`, tolerating a non-empty target.
 *
 * A plain `git clone <url> <root>` fails when `root` already contains files
 * (e.g. the link-package flow pre-creates a `<slug>/` subdir there). We
 * clone into a fresh sibling temp dir, then move each top-level entry into
 * `root`, skipping any that already exist. The `.git` dir is moved too unless
 * `root/.git` already exists.
 *
 * The `cloneFn` primitive is the same injected-or-real clone used for app/core —
 * tests inject a stub that records URLs but does not create files, so the
 * move logic will simply move nothing from an empty temp dir (which is fine
 * for unit tests). Real runs move the full repo contents.
 */
function cloneWorkspaceIntoRoot(
    url: string,
    root: string,
    cloneFn: (url: string, dest: string, ref?: string) => boolean
): boolean {
    const tempDir = mkdtempSync(join(tmpdir(), 'tinycld-workspace-'))
    try {
        if (!cloneFn(url, tempDir)) return false
        const rootHasGit = existsSync(join(root, '.git'))
        for (const entry of readdirSync(tempDir)) {
            // Skip .git if root already has one
            if (entry === '.git' && rootHasGit) continue
            const src = join(tempDir, entry)
            const dest = join(root, entry)
            // Never overwrite an entry that already exists in root
            if (existsSync(dest)) continue
            renameSync(src, dest)
        }
        return true
    } finally {
        rmSync(tempDir, { recursive: true, force: true })
    }
}

/**
 * Assemble a workspace skeleton at opts.root: if root is not yet a workspace,
 * clone the workspace meta-repo into it first (self-init), then write the full
 * manifest, then clone ONLY app + core + the explicitly-requested feature
 * members (skipping any already present — e.g. a CI-checked-out member).
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

    // Self-init: clone the workspace meta-repo into root if it isn't already
    // a workspace root. This provides package-scripts/, tinycld.packages.ts,
    // tests/, .node-version, .go-version, .npmrc, and the canonical root
    // package.json before anything else runs.
    if (!looksLikeWorkspaceRoot(opts.root)) {
        if (cloneWorkspaceIntoRoot(`${repoBase}/workspace.git`, opts.root, clone)) {
            present.push('workspace')
        }
    }

    // Merge the canonical workspaces list + postinstall into any existing
    // package.json (provided by the workspace clone), or write defaults when
    // no file exists yet (workspace clone was skipped or failed).
    writeWorkspaceManifest(opts.root)

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
