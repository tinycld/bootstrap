import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// All feature members that exist in the ecosystem. The workspace manifest lists
// ALL of them (npm tolerates absent dirs), so a partial checkout still installs.
// But --assemble-only CLONES only app+core+requested — we do NOT force-clone all.
const ALL_FEATURES = ['contacts', 'mail', 'calendar', 'drive', 'calc', 'text', 'google-takeout-import'] as const

// The `tinycld` member is the one always-cloned repo (tinycld/tinycld): it is
// the merged app shell + core. assembleWorkspace seeds it directly, pinnable via
// tinycldRef. Both @tinycld/core (at tinycld/core) and @tinycld/package-scripts
// (the tinycld-pkg CLI, at tinycld/package-scripts) live NESTED inside it, so
// they arrive with the single clone and are never cloned separately.

// Listed in the manifest workspaces array (everything that could exist). The
// nested member paths tinycld/core and tinycld/package-scripts are valid npm
// workspace entries that resolve inside the one cloned `tinycld` repo.
const ALL_MEMBERS = ['tinycld', 'tinycld/core', 'tinycld/package-scripts', ...ALL_FEATURES] as const

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
        '# pnpm 11 ships a default minimumReleaseAge supply-chain gate (~24h) that',
        '# rejects very freshly-published versions. The @tinycld/* libraries are',
        '# first-party and released in lockstep with these members, so a same-day',
        '# pbtsdb (or other @tinycld dep) bump must install immediately rather than',
        '# blocking install/CI for a day. Exclude them from the gate; third-party',
        '# packages still get the freshness window.',
        'minimumReleaseAgeExclude:',
        '  - pbtsdb',
        "  - '@tinycld/*'",
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
            // link-members runs FIRST so the @tinycld/<member> symlinks (notably
            // @tinycld/core) exist before the generator's package-build step
            // (text's webview-editor build.ts does a bare `import '@tinycld/core/...'`
            // resolved by package name, which fails on a CLEAN install if the
            // symlink isn't there yet). It then runs AGAIN after generate to add
            // the @tinycld/app-generated link (whose target, tinycld/lib/generated,
            // only exists once generate has run); link-members is idempotent and
            // skips app-generated when absent, so the first pass is harmless and
            // the second completes the graph. All app scripts run from tinycld/.
            postinstall:
                'tsx scripts/link-members.ts && cd tinycld && pnpm run packages:generate && cd .. && tsx scripts/link-members.ts && cd tinycld && pnpm run assets:copy-pdfjs',
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

    writeRootBiomeConfig(dir)
}

/**
 * Write the workspace-root biome.json. Biome searches only UPWARD for config,
 * and the canonical biome.json lives at <root>/tinycld/ — a SIBLING of the
 * feature members, never an ancestor. Without a root config, running biome from
 * inside a member (or via the editor/LSP) finds nothing and falls back to
 * biome's built-in defaults, flooding output with bogus reformatting. This
 * minimal `root: true` config extends the canonical one (which is `root: false`)
 * so it's resolvable from anywhere. Members may add their own `root: false`
 * biome.json extending canonical to override rules; most don't.
 *
 * Seeded here so a freshly-assembled root lints before its first install. The
 * generator also writes it on every install (the canonical config's `root:
 * false` ships via the tinycld repo and breaks `pnpm run lint` if no root config
 * sits above it), so this is the belt to the generator's suspenders. Content is
 * static, so always rewrite.
 *
 * `vcs.root` points at the tinycld/ member, NOT the workspace root: the
 * canonical config relies on `.gitignore` to exclude generated/build artifacts,
 * and the only .gitignore listing them is tinycld/.gitignore. Once canonical is
 * `root: false`, every invocation under the workspace root resolves THIS config
 * as the root and inherits its vcs settings, so useIgnoreFile must be anchored
 * here. A freshly-assembled workspace root has no .gitignore (and isn't a git
 * repo), so pointing biome there would make it error "couldn't find an ignore
 * file".
 */
function writeRootBiomeConfig(root: string): void {
    const config = {
        $schema: 'https://biomejs.dev/schemas/2.4.16/schema.json',
        root: true,
        extends: ['./tinycld/biome.json'],
        vcs: { enabled: true, clientKind: 'git', useIgnoreFile: true, root: 'tinycld' },
    }
    writeFileSync(join(root, 'biome.json'), `${JSON.stringify(config, null, 4)}\n`)
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
    /** Pin the always-cloned `tinycld` member (app shell + core) to this ref (tag/branch). Default HEAD. */
    tinycldRef?: string
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
 * ONLY the tinycld member (merged app shell + core) + the explicitly-requested
 * feature members (skipping any already present — e.g. a CI-checked-out member,
 * where the merged repo is checked out into the tinycld/ slot). There is NO workspace
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
    // with an @ref dedupes to one clone (the ref-bearing entry wins). The
    // `tinycld` repo (merged app shell + core, with core + package-scripts
    // nested) is always cloned and pinnable via tinycldRef.
    const refByName = new Map<string, string | undefined>()
    refByName.set('tinycld', opts.tinycldRef)
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
