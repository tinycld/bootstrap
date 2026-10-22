import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// The `tinycld` member is the one always-cloned repo (tinycld/tinycld): it is
// the merged app shell + core. assembleWorkspace seeds it directly, pinnable via
// tinycldRef. Both @tinycld/core (at tinycld/core) and @tinycld/package-scripts
// (the tinycld-pkg CLI, at tinycld/package-scripts) live NESTED inside it, so
// they arrive with the single clone and are never cloned separately.

/**
 * Run the workspace root-writer that ships INSIDE the cloned tinycld repo.
 * Bootstrap deliberately knows nothing about the root files' contents — not
 * the vendor version pins (tinycld/core/package-versions.json) and not the
 * file formats. A vendor bump or format change is a tinycld commit, never a
 * bootstrap release. Node >=24 (our engines floor) executes the TypeScript
 * directly via native type stripping; the script is self-contained by
 * contract, so no install has to have happened yet.
 */
function delegateWorkspaceRoot(root: string): void {
    const script = join(root, 'tinycld', 'scripts', 'write-workspace-root.ts')
    const tinycldDir = join(root, 'tinycld')
    if (!existsSync(script)) {
        throw new Error(
            `${script} not found — the tinycld checkout at ${tinycldDir} predates core-owned ` +
                'workspace roots — update it (git pull) or pass a newer tinycldRef; or use an ' +
                'older @tinycld/bootstrap that still writes root files itself.'
        )
    }
    const r = spawnSync(process.execPath, [script], { cwd: root, stdio: 'inherit' })
    if (r.status !== 0) {
        throw new Error(`write-workspace-root failed (exit ${r.status ?? 'signal'}) — see output above`)
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
    /** Pin the always-cloned `tinycld` member (app shell + core) to this ref (tag/branch). Default HEAD. */
    tinycldRef?: string
    /** Injected for tests; defaults to real git clone. `ref` pins the checkout. */
    clone?: (url: string, dest: string, ref?: string) => boolean
}

export interface MemberSpec {
    /** Directory name the member is cloned into. */
    name: string
    /** Explicit clone URL; absent for a bare name, which resolves against repoBase. */
    url?: string
    ref?: string
}

const DIR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const OWNER_REPO_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/

/**
 * Parse a `--with` spec: `name`, `owner/repo`, or a full git URL, each with an
 * optional `@ref` suffix. The `@` that starts a ref is the last one after the
 * final `/` or `:`, so the `git@` in `git@host:o/r.git` is never mistaken for it.
 */
export function parseMemberSpec(spec: string, repoBase: string): MemberSpec {
    const at = spec.lastIndexOf('@')
    const hasRef = at > spec.lastIndexOf('/') && at > spec.lastIndexOf(':')
    const target = hasRef ? spec.slice(0, at) : spec
    const ref = hasRef ? spec.slice(at + 1) || undefined : undefined

    const isUrl = target.includes('://') || target.startsWith('git@')
    const isOwnerRepo = !isUrl && OWNER_REPO_RE.test(target)
    if (!isUrl && !isOwnerRepo) return { name: target, ref }

    const name =
        target
            .replace(/\.git$/, '')
            .split(/[/:]/)
            .pop() ?? ''
    if (isUrl) return { name, url: target, ref }
    const host = repoBase.startsWith('http') ? 'https://github.com/' : 'git@github.com:'
    return { name, url: `${host}${target}.git`, ref }
}

function realClone(url: string, dest: string, ref?: string): boolean {
    const args = ['clone', '--depth', '1']
    if (ref) args.push('--branch', ref)
    args.push(url, dest)
    const r = spawnSync('git', args, { stdio: 'inherit' })
    return r.status === 0
}

/**
 * Assemble a workspace skeleton at opts.root: clone ONLY the tinycld member
 * (merged app shell + core) + the explicitly-requested feature members
 * (skipping any already present — e.g. a CI-checked-out member, where the
 * merged repo is checked out into the tinycld/ slot), then lay down the root
 * scaffolding bootstrap still owns (copyWorkspaceTemplate: tinycld.packages.ts,
 * vitest.config.ts, tests/ stubs, version files) and delegate everything
 * content-bearing about the workspace root (package.json, pnpm-workspace.yaml,
 * package-versions.json, .watchmanconfig, biome.json, .npmrc) to the
 * root-writer script that ships INSIDE the cloned tinycld repo. There is NO
 * workspace meta-repo clone: bootstrap only clones members, never writes
 * vendor version pins or root-file formats itself.
 * Invalid member names throw. Returns the members that ended up present. Does
 * NOT run the install (the caller / CI controls that — e.g. `pnpm install` or a
 * frozen-lockfile install for reproducible builds).
 */
export function assembleWorkspace(opts: AssembleWorkspaceOptions): string[] {
    const repoBase = opts.repoBase ?? 'git@github.com:tinycld'
    const clone = opts.clone ?? realClone

    const requested = (opts.members ?? []).map((spec) => parseMemberSpec(spec, repoBase))
    const invalid = requested.filter((m) => !DIR_NAME_RE.test(m.name))
    if (invalid.length > 0) {
        throw new Error(`Invalid member name(s): ${invalid.map((m) => m.name || '(empty)').join(', ')}`)
    }

    // Build the clone set keyed by member NAME so a member passed both bare and
    // with an @ref dedupes to one clone (the ref-bearing entry wins). The
    // `tinycld` repo (merged app shell + core, with core + package-scripts
    // nested) is always cloned and pinnable via tinycldRef.
    const byName = new Map<string, { url?: string; ref?: string }>()
    byName.set('tinycld', { ref: opts.tinycldRef })
    for (const { name, url, ref } of requested) {
        // A later ref overrides an earlier bare entry; a bare entry never clears
        // an existing ref.
        const prior = byName.get(name)
        if (!prior) byName.set(name, { url, ref })
        else if (ref !== undefined) byName.set(name, { url: url ?? prior.url, ref })
    }

    const present: string[] = []
    for (const [name, { url, ref }] of byName) {
        const dest = join(opts.root, name)
        if (existsSync(join(dest, '.git')) || existsSync(join(dest, 'package.json'))) {
            present.push(name)
            continue
        }
        if (clone(url ?? `${repoBase}/${name}.git`, dest, ref)) present.push(name)
    }

    // Root scaffolding AFTER cloning: the static template files bootstrap
    // still owns (never overwrites), then the cloned repo's own root-writer
    // for everything content-bearing. Skip delegation when tinycld itself
    // failed to clone — the caller (runAssembleOnly) raises the clearer
    // "failed to clone required member" error.
    copyWorkspaceTemplate(opts.root)
    if (present.includes('tinycld')) delegateWorkspaceRoot(opts.root)
    return present
}
