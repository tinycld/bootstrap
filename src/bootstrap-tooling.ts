import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// All feature members that exist in the ecosystem. The workspace manifest lists
// ALL of them (npm tolerates absent dirs), so a partial checkout still installs.
// But --tooling CLONES only app+core+requested — we do NOT force-clone all.
const ALL_FEATURES = ['contacts', 'mail', 'calendar', 'drive', 'calc', 'text', 'google-takeout-import'] as const

// Always cloned by tooling mode (the minimum viable workspace). package-scripts
// ships inside the workspace meta-repo itself, so it is never cloned.
const ALWAYS_CLONE = ['app', 'core'] as const

// Listed in the manifest workspaces array (everything that could exist).
const ALL_MEMBERS = ['app', 'core', 'package-scripts', ...ALL_FEATURES] as const

/**
 * Write a workspace-root package.json + .npmrc into `dir`. The workspaces array
 * ALWAYS lists every possible member — npm ignores entries whose dirs are
 * absent, so a partial checkout (app+core+one feature) installs fine, and
 * cloning more features later needs no manifest edit.
 */
export function writeWorkspaceManifest(dir: string): void {
    const pkg = {
        name: '@tinycld/workspace',
        version: '0.0.0',
        private: true,
        type: 'module',
        workspaces: [...ALL_MEMBERS],
        scripts: {
            postinstall: 'cd app && npm run packages:generate && npm run assets:copy-pdfjs',
        },
    }
    writeFileSync(join(dir, 'package.json'), `${JSON.stringify(pkg, null, 4)}\n`)
    writeFileSync(join(dir, '.npmrc'), 'legacy-peer-deps=true\n')
}

export interface BootstrapToolingOptions {
    /** Directory to assemble the workspace in (becomes the workspace root). */
    root: string
    /**
     * Feature members to clone IN ADDITION to app+core. Defaults to NONE — the
     * whole point is a minimal checkout. Pass slugs via --with on the CLI.
     */
    members?: readonly string[]
    /** git base, e.g. git@github.com:tinycld. */
    repoBase?: string
    /** Injected for tests; defaults to real git clone. */
    clone?: (url: string, dest: string) => boolean
}

function realClone(url: string, dest: string): boolean {
    const r = spawnSync('git', ['clone', '--depth', '1', url, dest], { stdio: 'inherit' })
    return r.status === 0
}

/**
 * Assemble a workspace skeleton at opts.root: write the (full) manifest, then
 * clone ONLY app + core + the explicitly-requested feature members (skipping any
 * already present — e.g. a CI-checked-out member). Unknown member names throw.
 * Returns the members that ended up present. Does NOT run npm install (the
 * caller / CI controls that, since it may want a clean `npm ci`).
 */
export function bootstrapTooling(opts: BootstrapToolingOptions): string[] {
    const requested = opts.members ?? []
    const unknown = requested.filter((m) => !ALL_FEATURES.includes(m as (typeof ALL_FEATURES)[number]))
    if (unknown.length > 0) {
        throw new Error(`Unknown feature member(s): ${unknown.join(', ')}. Known: ${ALL_FEATURES.join(', ')}`)
    }
    const repoBase = opts.repoBase ?? 'git@github.com:tinycld'
    const clone = opts.clone ?? realClone

    writeWorkspaceManifest(opts.root)

    const toClone = Array.from(new Set([...ALWAYS_CLONE, ...requested]))
    const present: string[] = []
    for (const m of toClone) {
        const dest = join(opts.root, m)
        if (existsSync(join(dest, '.git')) || existsSync(join(dest, 'package.json'))) {
            present.push(m)
            continue
        }
        if (clone(`${repoBase}/${m}.git`, dest)) present.push(m)
    }
    return present
}
