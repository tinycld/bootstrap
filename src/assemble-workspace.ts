import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// All feature members that exist in the ecosystem. The workspace manifest lists
// ALL of them (npm tolerates absent dirs), so a partial checkout still installs.
// But --assemble-only CLONES only app+core+requested — we do NOT force-clone all.
const ALL_FEATURES = ['contacts', 'mail', 'calendar', 'drive', 'calc', 'text', 'google-takeout-import'] as const

// app + core are always cloned by assemble-only mode (the minimum viable
// workspace); the clone set in assembleWorkspace seeds them directly (pinnable
// via appRef/coreRef). package-scripts (the tinycld-pkg CLI) now lives INSIDE
// the app member at app/package-scripts, so it arrives with the app clone and
// is never cloned separately.

// Listed in the manifest workspaces array (everything that could exist). The
// nested member path app/package-scripts is a valid npm workspace entry.
const ALL_MEMBERS = ['app', 'app/package-scripts', 'core', ...ALL_FEATURES] as const

// pnpm version pinned via the package.json "packageManager" field so corepack
// resolves the same pnpm everywhere (local, CI, EAS). Bump in lockstep with the
// workspace's committed packageManager.
const PNPM_VERSION = '11.3.0'

/**
 * Direct child dirs of `root` that look like a feature member already on disk:
 * a package.json plus a manifest.ts/js. This mirrors the app generator's own
 * discovery (it scans the workspace root for manifest-bearing members), so the
 * member list bootstrap writes stays in sync with what the generator will load.
 *
 * The motivating case is CI / a custom package: a member checked out into its
 * slot but absent from ALL_MEMBERS is discovered by the generator yet never
 * linked by pnpm (→ "No manifest found"). Self-registering it here closes that
 * gap without requiring every package to be hardcoded in ALL_FEATURES.
 */
function discoverPresentMembers(root: string): string[] {
    let entries: string[]
    try {
        entries = readdirSync(root)
    } catch {
        return []
    }
    return entries.filter((name) => {
        if (name === 'node_modules' || name.startsWith('.')) return false
        const dir = join(root, name)
        try {
            if (!statSync(dir).isDirectory()) return false
        } catch {
            return false
        }
        const hasManifest = existsSync(join(dir, 'manifest.ts')) || existsSync(join(dir, 'manifest.js'))
        return existsSync(join(dir, 'package.json')) && hasManifest
    })
}

/**
 * pnpm-workspace.yaml contents: member discovery list + the settings the
 * ecosystem depends on. node-linker=hoisted reproduces npm's flat node_modules
 * so feature siblings (peerDeps-only, no node_modules of their own) resolve
 * react/expo/etc. up to the root, and Metro/tsc resolution work unchanged.
 * pnpm 10+ reads these keys from THIS file, not .npmrc.
 *
 * `dir` is the workspace root: any manifest-bearing member already on disk but
 * not in ALL_MEMBERS (a CI- or custom-package checkout) is unioned into the
 * `packages:` list so pnpm links what the generator discovers. This list is the
 * source of truth pnpm reads — unlike the package.json `workspaces` hint.
 */
function pnpmWorkspaceYaml(dir: string): string {
    const allMembers = [...new Set([...ALL_MEMBERS, ...discoverPresentMembers(dir)])]
    const members = allMembers.map((m) => `  - ${m}`).join('\n')
    return [
        'nodeLinker: hoisted',
        'linkWorkspacePackages: true',
        'strictPeerDependencies: false',
        'enablePrePostScripts: true',
        '',
        'packages:',
        members,
        '',
        '# Build-script approvals (pnpm blocks dependency build scripts by default).',
        'allowBuilds:',
        '  esbuild: true',
        "  '@sentry/cli': true",
        '',
    ].join('\n')
}

/**
 * Write (or merge into) the workspace-root coordination files in `dir`:
 * package.json, pnpm-workspace.yaml, and scripts/link-members.ts.
 *
 * The workspace is a pnpm workspace. Member discovery + pnpm settings live in
 * pnpm-workspace.yaml (always rewritten — bootstrap owns the member list).
 * package.json carries the pinned packageManager, the tsx devDep the postinstall
 * needs, and the postinstall script (link-members + generator). When a
 * package.json already exists (real workspace checkout), its other fields are
 * preserved and only the bootstrap-owned bits are enforced.
 *
 * A legacy npm `workspaces` array is also written as a monorepo-detection HINT
 * for external tooling (EAS/expo archiver keys off it, not pnpm-workspace.yaml).
 * pnpm ignores it when pnpm-workspace.yaml is present.
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
    const existingDevDeps =
        typeof existing.devDependencies === 'object' && existing.devDependencies !== null
            ? (existing.devDependencies as Record<string, string>)
            : {}

    const pkg = {
        name: '@tinycld/workspace',
        version: '0.0.0',
        private: true,
        type: 'module',
        ...existing,
        packageManager: `pnpm@${PNPM_VERSION}`,
        // Monorepo-detection hint for external tooling (see doc comment); pnpm
        // itself reads members from pnpm-workspace.yaml and ignores this. Union
        // in any manifest-bearing member already on disk so the hint matches the
        // authoritative pnpm-workspace.yaml member list.
        workspaces: [...new Set([...ALL_MEMBERS, ...discoverPresentMembers(dir)])],
        scripts: {
            ...existingScripts,
            postinstall:
                'tsx scripts/link-members.ts && cd app && pnpm run packages:generate && pnpm run assets:copy-pdfjs',
        },
        devDependencies: {
            ...existingDevDeps,
            tsx: '^4.21.0',
        },
    }
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)

    // pnpm-workspace.yaml is the source of truth for members + settings — always
    // rewrite it (unlike package.json, no human-owned fields live here).
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), pnpmWorkspaceYaml(dir))

    // Minimal .npmrc: all pnpm settings live in pnpm-workspace.yaml (pnpm 10+
    // reads them there, not from .npmrc). Only written when absent (don't
    // clobber a real checkout's).
    const npmrcPath = join(dir, '.npmrc')
    if (!existsSync(npmrcPath)) {
        writeFileSync(npmrcPath, '# pnpm settings live in pnpm-workspace.yaml (pnpm 10+ reads them there).\n')
    }
}

/**
 * Resolve the workspace-template dir relative to this module. Published builds
 * have `dist/assemble-workspace.js` next to `templates/`; dev has
 * `src/assemble-workspace.ts` under the same parent. Both → `../templates/workspace`.
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

export interface AssembleWorkspaceOptions {
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
 * NOT run the install (the caller / CI controls that — e.g. `pnpm install` or a
 * frozen-lockfile install for reproducible builds).
 */
export function assembleWorkspace(opts: AssembleWorkspaceOptions): string[] {
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
