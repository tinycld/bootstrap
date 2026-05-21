import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { confirm, isCancel, log, spinner } from '@clack/prompts'
import pc from 'picocolors'
import { looksLikeWorkspaceRoot } from './layout.ts'

export const WORKSPACE_REPO_URL = 'git@github.com:tinycld/workspace.git'

export type LinkMode = 'prompt' | 'accept' | 'skip'

export interface LinkPackageInput {
    slug: string
    workspaceDir: string
    mode: LinkMode
    /** Injected for tests; defaults to a real `git clone`-into-an-existing-dir. */
    clone?: (url: string, dest: string) => boolean
    /** Injected for tests; defaults to a real `npm install`. */
    install?: (cwd: string) => boolean
}

/**
 * Add `slug` to `<workspaceDir>/package.json` `workspaces[]` if it isn't already
 * there. Idempotent, and a no-op when there's no package.json yet (which is the
 * case in bootstrap mode before the workspace meta-repo is cloned in).
 */
export function ensureMember(workspaceDir: string, slug: string): void {
    const pkgPath = join(workspaceDir, 'package.json')
    if (!existsSync(pkgPath)) return
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
    pkg.workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : []
    if (!pkg.workspaces.includes(slug)) {
        pkg.workspaces.push(slug)
        writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)
    }
}

/**
 * Offer to link the freshly-scaffolded package into the TinyCld workspace.
 *
 * "Linking" in the workspace layout means: make the package a workspace member
 * (its dir name appears in the root `package.json` `workspaces[]`) and run
 * `npm install` at the workspace root — npm creates the `node_modules/@tinycld/*`
 * symlink and the root `postinstall` runs the generator.
 *
 * Two shapes, distinguished by whether `workspaceDir` is already a workspace root:
 *   - attach: `workspaceDir` already holds the workspace meta-repo (its
 *     package.json name is `@tinycld/workspace`). No clone — just ensure the
 *     member and install.
 *   - bootstrap: `workspaceDir` is a fresh wrapper that only contains the
 *     scaffolded `<slug>/` so far. Clone the workspace meta-repo *into* it
 *     (around the existing package dir), then ensure the member and install.
 *
 * Returns true if the user chose to link (even if a subprocess failed — the
 * error is already logged, and we don't want to follow up with manual steps
 * when the user already expressed intent). Returns false only when linking was
 * declined or skipped.
 */
export async function offerLinkPackage({
    slug,
    workspaceDir,
    mode,
    clone = realClone,
    install = realInstall,
}: LinkPackageInput): Promise<boolean> {
    if (mode === 'skip') return false

    // A wrapper that isn't yet a workspace root needs the meta-repo cloned in.
    const needsClone = !looksLikeWorkspaceRoot(workspaceDir)

    if (mode === 'prompt') {
        const message = needsClone
            ? `Clone the tinycld workspace and link ${pc.bold(slug)} now?`
            : `Link ${pc.bold(slug)} into the workspace now?`
        const answer = await confirm({ message, initialValue: true })
        if (isCancel(answer) || answer !== true) return false
    }

    if (needsClone) {
        const s = spinner()
        s.start('Cloning the tinycld workspace')
        if (!clone(WORKSPACE_REPO_URL, workspaceDir)) {
            s.stop(pc.red('Clone failed'), 1)
            return true
        }
        s.stop('Cloned the tinycld workspace')
    }

    ensureMember(workspaceDir, slug)

    const i = spinner()
    i.start('Installing workspace (npm install)')
    if (!install(workspaceDir)) {
        i.stop(pc.red('npm install failed'), 1)
        return true
    }
    i.stop('Installed workspace')

    log.success(`Linked ${pc.bold(slug)} into the workspace`)
    return true
}

/**
 * Clone `url` into `dest`, tolerating a `dest` that already exists and holds
 * files (e.g. the scaffolded `<slug>/` subdir). `git clone <url> <dest>` refuses
 * a non-empty target, so we clone into a temp dir on the same filesystem (a
 * sibling of `dest`) and then move every top-level entry — including `.git` —
 * into `dest`, skipping anything that would clobber an existing entry.
 *
 * Exported for unit testing the clone-into-a-non-empty-wrapper path (against a
 * local git remote, no network).
 */
export function realClone(url: string, dest: string): boolean {
    const tmp = mkdtempSync(join(dirname(dest), '.tinycld-workspace-'))
    try {
        const result = spawnSync('git', ['clone', url, tmp], { stdio: 'pipe', encoding: 'utf8' })
        if (result.status !== 0) {
            log.error(result.stderr?.trim() || 'git clone exited non-zero')
            return false
        }
        for (const entry of readdirSync(tmp)) {
            const target = join(dest, entry)
            if (existsSync(target)) {
                // Don't overwrite the already-scaffolded package dir (or any
                // other pre-existing entry the user dropped in the wrapper).
                log.warn(`Keeping existing ${entry}; not overwriting from the workspace clone`)
                continue
            }
            renameSync(join(tmp, entry), target)
        }
        return true
    } catch (err) {
        log.error(err instanceof Error ? err.message : String(err))
        return false
    } finally {
        rmSync(tmp, { recursive: true, force: true })
    }
}

function realInstall(cwd: string): boolean {
    const r = spawnSync('npm', ['install'], { cwd, stdio: 'pipe', encoding: 'utf8' })
    if (r.status !== 0) {
        log.error(r.stderr?.trim() || 'npm install exited non-zero')
        return false
    }
    return true
}
