import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

/**
 * Workspace-layout decisions for bootstrap.
 *
 * When invoked from a directory that already contains a tinycld app shell
 * checkout (a child directory named `tinycld/` whose package.json declares
 * the `tinycld` package), we treat the cwd as a workspace root and scaffold
 * the new package alongside it: `<cwd>/<slug>/`.
 *
 * Otherwise, we treat this as a fresh-start bootstrap: create a wrapper
 * directory `<cwd>/tinycld-<slug>/`, clone tinycld into
 * `<cwd>/tinycld-<slug>/tinycld/`, and scaffold the package as
 * `<cwd>/tinycld-<slug>/<slug>/`. The user gets a self-contained workspace
 * they can `cd` into and run.
 *
 * The resulting `appDir` is always `<workspace>/tinycld/` regardless of mode.
 */

export type Layout =
    | { mode: 'attach'; targetDir: string; appDir: string }
    | { mode: 'bootstrap'; targetDir: string; appDir: string; wrapperDir: string }

const APP_DIR_NAME = 'tinycld'

export function detectLayout(slug: string, cwd: string = process.cwd()): Layout {
    const candidateApp = join(cwd, APP_DIR_NAME)
    if (looksLikeAppShell(candidateApp)) {
        return {
            mode: 'attach',
            targetDir: resolve(cwd, slug),
            appDir: candidateApp,
        }
    }

    const wrapperDir = resolve(cwd, `${APP_DIR_NAME}-${slug}`)
    return {
        mode: 'bootstrap',
        targetDir: join(wrapperDir, slug),
        appDir: join(wrapperDir, APP_DIR_NAME),
        wrapperDir,
    }
}

/**
 * A directory "looks like" the tinycld app shell when it has a package.json
 * declaring `name: "tinycld"`. The bare directory check would false-match any
 * unrelated `tinycld` directory; the package.json check is fast (one read of
 * a file we'd be reading anyway) and unambiguous now that the app shell's
 * package.json `name` field has been renamed from "@tinycld/app" to "tinycld".
 */
export function looksLikeAppShell(dir: string): boolean {
    const pkgPath = join(dir, 'package.json')
    if (!existsSync(pkgPath)) return false
    try {
        const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
        return pkg?.name === 'tinycld'
    } catch {
        return false
    }
}
