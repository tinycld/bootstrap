import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { confirm, isCancel, log, spinner } from '@clack/prompts'
import pc from 'picocolors'
import { bootstrapTooling } from './bootstrap-tooling.ts'
import { looksLikeWorkspaceRoot } from './layout.ts'

export type LinkMode = 'prompt' | 'accept' | 'skip'

export interface LinkPackageInput {
    slug: string
    workspaceDir: string
    mode: LinkMode
    /**
     * Injected for tests; defaults to assembling the workspace (app + core +
     * manifest) at `workspaceDir` via `bootstrapTooling`, honoring
     * `TINYCLD_REPO_BASE` so keyless/HTTPS environments work.
     */
    assemble?: (dir: string) => void
    /** Injected for tests; defaults to a real `npm install`. */
    install?: (cwd: string) => boolean
}

/**
 * Add `slug` to `<workspaceDir>/package.json` `workspaces[]` if it isn't already
 * there. Idempotent, and a no-op when there's no package.json yet.
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
 *     package.json name is `@tinycld/workspace`). No assembly — just ensure the
 *     member and install. The existing root package.json is left untouched.
 *   - bootstrap: `workspaceDir` is a fresh wrapper that only contains the
 *     scaffolded `<slug>/` so far. Assemble the workspace *around* it — write the
 *     workspace manifest and clone app + core via `bootstrapTooling` — then
 *     ensure the new member and install. The `postinstall` (`cd app && …`) only
 *     succeeds once `app/` exists, which is why we assemble before installing.
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
    assemble = realAssemble,
    install = realInstall,
}: LinkPackageInput): Promise<boolean> {
    if (mode === 'skip') return false

    // A wrapper that isn't yet a workspace root needs app + core assembled in.
    const needsClone = !looksLikeWorkspaceRoot(workspaceDir)

    if (mode === 'prompt') {
        const message = needsClone
            ? `Clone the tinycld workspace (app + core) and link ${pc.bold(slug)} now?`
            : `Link ${pc.bold(slug)} into the workspace now?`
        const answer = await confirm({ message, initialValue: true })
        if (isCancel(answer) || answer !== true) return false
    }

    if (needsClone) {
        const s = spinner()
        s.start('Assembling the tinycld workspace (app + core)')
        try {
            assemble(workspaceDir)
        } catch (err) {
            s.stop(pc.red('Workspace assembly failed'), 1)
            log.error(err instanceof Error ? err.message : String(err))
            return true
        }
        s.stop('Assembled the tinycld workspace')
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
 * Assemble the workspace skeleton at `dir`: write the workspace manifest and
 * clone app + core (honoring `TINYCLD_REPO_BASE` for keyless/HTTPS envs).
 * `bootstrapTooling` is synchronous and throws on failure (unknown member, etc.);
 * `offerLinkPackage` wraps the call so the error surfaces in the spinner.
 */
function realAssemble(dir: string): void {
    bootstrapTooling({ root: dir, repoBase: process.env.TINYCLD_REPO_BASE })
}

function realInstall(cwd: string): boolean {
    const r = spawnSync('npm', ['install'], { cwd, stdio: 'pipe', encoding: 'utf8' })
    if (r.status !== 0) {
        log.error(r.stderr?.trim() || 'npm install exited non-zero')
        return false
    }
    return true
}
