import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { confirm, isCancel, log, spinner } from '@clack/prompts'
import pc from 'picocolors'
import { assembleWorkspace } from './assemble-workspace.ts'
import { looksLikeWorkspaceRoot } from './layout.ts'

export type LinkMode = 'prompt' | 'accept' | 'skip'

export interface LinkPackageInput {
    slug: string
    workspaceDir: string
    mode: LinkMode
    /**
     * Feature members to clone IN ADDITION to app+core when this is a bootstrap-mode
     * assembly (i.e. `workspaceDir` is not yet a workspace root). Ignored in attach
     * mode — an existing workspace root is left untouched, so its present-member set
     * is whatever it already was on disk. Threads `--with` from `--new + --with`.
     */
    members?: readonly string[]
    /**
     * Injected for tests; defaults to assembling the workspace (app + core +
     * `members`) at `workspaceDir` via `assembleWorkspace`, honoring
     * `TINYCLD_REPO_BASE` so keyless/HTTPS environments work.
     */
    assemble?: (dir: string, members?: readonly string[]) => void
    /** Injected for tests; defaults to a real `pnpm install`. */
    install?: (cwd: string) => boolean
}

/**
 * Make `slug` a workspace member: add it to pnpm-workspace.yaml's `packages:`
 * list (the source pnpm reads) and to the package.json `workspaces[]` tooling
 * hint. Idempotent; each file is a no-op when absent or already listing the slug.
 */
export function ensureMember(workspaceDir: string, slug: string): void {
    const pkgPath = join(workspaceDir, 'package.json')
    if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        pkg.workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : []
        if (!pkg.workspaces.includes(slug)) {
            pkg.workspaces.push(slug)
            writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 4)}\n`)
        }
    }

    const wsYamlPath = join(workspaceDir, 'pnpm-workspace.yaml')
    if (existsSync(wsYamlPath)) {
        const yaml = readFileSync(wsYamlPath, 'utf-8')
        // Already a member? (matches `  - <slug>` under packages:)
        const memberLine = new RegExp(`^\\s*-\\s+${slug}\\s*$`, 'm')
        if (!memberLine.test(yaml)) {
            // Append the slug to the packages: block. The block runs from the
            // `packages:` line until the next top-level key or EOF; insert after
            // the last `  - ` entry within it.
            const lines = yaml.split('\n')
            const pkgIdx = lines.findIndex((l) => /^packages:\s*$/.test(l))
            if (pkgIdx !== -1) {
                let lastEntry = pkgIdx
                for (let i = pkgIdx + 1; i < lines.length; i++) {
                    const line = lines[i] ?? ''
                    if (/^\s+-\s+/.test(line)) lastEntry = i
                    else if (/^\S/.test(line) && line.trim() !== '') break
                }
                lines.splice(lastEntry + 1, 0, `  - ${slug}`)
                writeFileSync(wsYamlPath, lines.join('\n'))
            }
        }
    }
}

/**
 * Offer to link the freshly-scaffolded package into the TinyCld workspace.
 *
 * "Linking" in the workspace layout means: make the package a workspace member
 * (its dir name appears in pnpm-workspace.yaml — and, as a tooling hint, the
 * root `package.json` `workspaces[]`) and run `pnpm install` at the workspace
 * root. The root `postinstall` runs link-members (which creates the
 * `node_modules/@tinycld/*` symlinks) and the generator.
 *
 * Two shapes, distinguished by whether `workspaceDir` is already a workspace root:
 *   - attach: `workspaceDir` is already an assembled workspace root (its
 *     package.json name is `@tinycld/workspace`). No assembly — just ensure the
 *     member and install. The existing root package.json is left untouched.
 *   - bootstrap: `workspaceDir` is a fresh wrapper that only contains the
 *     scaffolded `<slug>/` so far. Assemble the workspace *around* it —
 *     `assembleWorkspace` generates the root scaffolding and clones app + core
 *     (no workspace meta-repo) — then ensure the new member and install. The
 *     `postinstall` (`cd app && …`) only succeeds once `app/` exists, which is
 *     why we assemble before installing.
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
    members,
    assemble = realAssemble,
    install = realInstall,
}: LinkPackageInput): Promise<boolean> {
    if (mode === 'skip') return false

    // A wrapper that isn't yet a workspace root needs app + core assembled in.
    const needsClone = !looksLikeWorkspaceRoot(workspaceDir)

    // Describe what we're about to clone in the prompt + spinner so the user
    // (and the test runner) sees that --with members were honored.
    const assemblyLabel =
        members && members.length > 0
            ? `app + core + ${members.map((m) => m.replace(/@.*$/, '')).join(' + ')}`
            : 'app + core'

    if (mode === 'prompt') {
        const message = needsClone
            ? `Assemble the tinycld workspace (${assemblyLabel}) and link ${pc.bold(slug)} now?`
            : `Link ${pc.bold(slug)} into the workspace now?`
        const answer = await confirm({ message, initialValue: true })
        if (isCancel(answer) || answer !== true) return false
    }

    if (needsClone) {
        const s = spinner()
        s.start(`Assembling the tinycld workspace (${assemblyLabel})`)
        try {
            assemble(workspaceDir, members)
        } catch (err) {
            s.stop(pc.red('Workspace assembly failed'), 1)
            log.error(err instanceof Error ? err.message : String(err))
            return true
        }
        s.stop('Assembled the tinycld workspace')
    }

    ensureMember(workspaceDir, slug)

    const i = spinner()
    i.start('Installing workspace (pnpm install)')
    if (!install(workspaceDir)) {
        i.stop(pc.red('pnpm install failed'), 1)
        return true
    }
    i.stop('Installed workspace')

    log.success(`Linked ${pc.bold(slug)} into the workspace`)
    return true
}

/**
 * Assemble the workspace skeleton at `dir`: write the workspace manifest and
 * clone app + core (+ any `members` from --with), honoring `TINYCLD_REPO_BASE`
 * for keyless/HTTPS envs.
 * `assembleWorkspace` is synchronous and throws on failure (unknown member,
 * clone error, etc.); `offerLinkPackage` wraps the call so the error surfaces
 * in the spinner.
 */
function realAssemble(dir: string, members?: readonly string[]): void {
    assembleWorkspace({
        root: dir,
        repoBase: process.env.TINYCLD_REPO_BASE,
        members,
    })
}

function realInstall(cwd: string): boolean {
    // corepack enable makes the pnpm version pinned in package.json's
    // packageManager field available, then install via pnpm. The workspace is a
    // pnpm workspace (pnpm-workspace.yaml); npm is no longer used to install.
    spawnSync('corepack', ['enable'], { cwd, stdio: 'pipe', encoding: 'utf8' })
    const r = spawnSync('pnpm', ['install'], { cwd, stdio: 'pipe', encoding: 'utf8' })
    if (r.status !== 0) {
        log.error(r.stderr?.trim() || 'pnpm install exited non-zero')
        return false
    }
    return true
}
