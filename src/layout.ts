import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Workspace-layout decisions for bootstrap.
 *
 * "attach": cwd is already a TinyCld workspace root (its package.json declares
 * name "@tinycld/workspace"). Scaffold the new package as a child <cwd>/<slug>/.
 *
 * "bootstrap": cwd is not a workspace root. Create a wrapper <cwd>/tinycld-<slug>/,
 * clone the workspace meta-repo into it (the caller does the clone), and scaffold
 * the package at <wrapper>/<slug>/.
 */
export type Layout =
    | { mode: 'attach'; targetDir: string; workspaceDir: string }
    | { mode: 'bootstrap'; targetDir: string; workspaceDir: string; wrapperDir: string }

export function detectLayout(slug: string, cwd: string = process.cwd()): Layout {
    if (looksLikeWorkspaceRoot(cwd)) {
        return { mode: 'attach', targetDir: resolve(cwd, slug), workspaceDir: cwd }
    }
    const wrapperDir = resolve(cwd, `tinycld-${slug}`)
    return {
        mode: 'bootstrap',
        targetDir: join(wrapperDir, slug),
        workspaceDir: wrapperDir,
        wrapperDir,
    }
}

/** A directory is a workspace root when its package.json name is "@tinycld/workspace". */
export function looksLikeWorkspaceRoot(dir: string): boolean {
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) return false
    try {
        return JSON.parse(readFileSync(pkgPath, 'utf-8'))?.name === '@tinycld/workspace'
    } catch {
        return false
    }
}
