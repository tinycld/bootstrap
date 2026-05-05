import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { confirm, isCancel, log, spinner } from '@clack/prompts'
import pc from 'picocolors'

const APP_REPO_URL = 'git@github.com:tinycld/tinycld.git'
const APP_DIR_NAME = 'tinycld'

export type LinkMode = 'prompt' | 'accept' | 'skip'

export interface LinkPackageInput {
    packageName: string
    targetDir: string
    mode: LinkMode
}

/**
 * Returns true if the user chose to link (even if a subprocess failed —
 * the error is already logged, and we don't want to follow up with
 * "here are the manual steps" when the user already expressed intent).
 * Returns false only if linking was declined or skipped.
 *
 * Linking happens against the tinycld **app shell** (sibling repo
 * `tinycld/tinycld`), which owns `packages:link` and bundles `@tinycld/core`
 * at `packages/@tinycld/core/`. This package's tsconfig
 * (`"@tinycld/core/*": ["../tinycld/packages/@tinycld/core/*"]`) and its Go
 * server's `replace tinycld.org/core => ../../tinycld/packages/@tinycld/core/server`
 * directive both resolve into the bundled core inside the app shell.
 */
export async function offerLinkPackage({ packageName, targetDir, mode }: LinkPackageInput): Promise<boolean> {
    if (mode === 'skip') return false

    const parentDir = dirname(targetDir)
    const appDir = join(parentDir, APP_DIR_NAME)
    const appExists = existsSync(appDir)

    if (mode === 'prompt') {
        const prompt = appExists
            ? `Link ${pc.bold(packageName)} into ${pc.bold(APP_DIR_NAME)} now?`
            : `Clone ${pc.bold(APP_DIR_NAME)} (shallow) and link ${pc.bold(packageName)} into it now?`

        const answer = await confirm({ message: prompt, initialValue: true })
        if (isCancel(answer) || answer !== true) return false
    }

    if (!appExists) {
        if (!cloneRepo(APP_REPO_URL, appDir)) return true
    } else {
        log.info(`Using existing ${APP_DIR_NAME} at ${appDir}`)
    }

    const install = spinner()
    install.start(`Installing ${APP_DIR_NAME} dependencies (bun install)`)
    const inst = spawnSync('bun', ['install'], { cwd: appDir, stdio: 'pipe', encoding: 'utf8' })
    if (inst.status !== 0) {
        install.stop(pc.red('bun install failed'), 1)
        log.error(inst.stderr.trim() || 'bun install exited non-zero')
        return true
    }
    install.stop(`Installed ${APP_DIR_NAME} dependencies`)

    // packages:link in tinycld takes a sibling-directory locator and reads
    // the package name from the sibling's package.json. Pass a path relative
    // to the app shell so the symlink target stays portable.
    const link = spinner()
    link.start(`Linking ${packageName}`)
    const locator = relative(appDir, targetDir) || targetDir
    const linkResult = spawnSync('bun', ['run', 'packages:link', locator], {
        cwd: appDir,
        stdio: 'pipe',
        encoding: 'utf8',
    })
    if (linkResult.status !== 0) {
        link.stop(pc.red('Link failed'), 1)
        log.error(linkResult.stderr.trim() || 'packages:link exited non-zero')
        return true
    }
    link.stop(`Linked ${packageName} into ${APP_DIR_NAME}`)

    return true
}

function cloneRepo(url: string, dest: string): boolean {
    const s = spinner()
    s.start(`Cloning ${url} into ${dest}`)
    const result = spawnSync('git', ['clone', '--depth', '1', url, dest], {
        stdio: 'pipe',
        encoding: 'utf8',
    })
    if (result.status !== 0) {
        s.stop(pc.red('Clone failed'), 1)
        log.error(result.stderr.trim() || 'git clone exited non-zero')
        return false
    }
    s.stop(`Cloned ${dest}`)
    return true
}
