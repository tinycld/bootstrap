import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureMember, offerLinkPackage, realClone } from '../src/link-package.ts'

let dir: string
const cleanups: string[] = []
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    while (cleanups.length) {
        const d = cleanups.pop()
        if (d) rmSync(d, { recursive: true, force: true })
    }
})

function writeWorkspaceJson(target: string, workspaces: string[]): void {
    writeFileSync(join(target, 'package.json'), JSON.stringify({ name: '@tinycld/workspace', workspaces }))
}

describe('ensureMember', () => {
    it('adds slug to workspaces when absent', () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        writeWorkspaceJson(dir, ['app', 'core'])
        ensureMember(dir, 'newpkg')
        expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).workspaces).toContain('newpkg')
    })

    it('is idempotent when slug already present', () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        writeWorkspaceJson(dir, ['app', 'newpkg'])
        ensureMember(dir, 'newpkg')
        const ws = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).workspaces
        expect(ws.filter((w: string) => w === 'newpkg').length).toBe(1)
    })

    it('is a no-op when there is no package.json', () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        expect(() => ensureMember(dir, 'newpkg')).not.toThrow()
        expect(existsSync(join(dir, 'package.json'))).toBe(false)
    })

    it('tolerates a package.json with no workspaces array', () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@tinycld/workspace' }))
        ensureMember(dir, 'newpkg')
        expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).workspaces).toEqual(['newpkg'])
    })
})

describe('offerLinkPackage', () => {
    it('attach mode (workspace root present): no clone, installs + ensures member', async () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        writeWorkspaceJson(dir, ['app'])
        let cloned = false
        let installed = ''
        const r = await offerLinkPackage({
            slug: 'foo',
            workspaceDir: dir,
            mode: 'accept',
            clone: () => {
                cloned = true
                return true
            },
            install: (cwd) => {
                installed = cwd
                return true
            },
        })
        expect(r).toBe(true)
        expect(cloned).toBe(false)
        expect(installed).toBe(dir)
        expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).workspaces).toContain('foo')
    })

    it('bootstrap mode (no workspace root yet): clones then installs', async () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        let cloned = false
        let installed = ''
        const r = await offerLinkPackage({
            slug: 'foo',
            workspaceDir: dir,
            mode: 'accept',
            clone: () => {
                cloned = true
                return true
            },
            install: (cwd) => {
                installed = cwd
                return true
            },
        })
        expect(r).toBe(true)
        expect(cloned).toBe(true)
        expect(installed).toBe(dir)
    })

    it('skip mode returns false, no side effects', async () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        let touched = false
        const r = await offerLinkPackage({
            slug: 'foo',
            workspaceDir: dir,
            mode: 'skip',
            clone: () => {
                touched = true
                return true
            },
            install: () => {
                touched = true
                return true
            },
        })
        expect(r).toBe(false)
        expect(touched).toBe(false)
    })

    it('returns true (intent expressed) but skips install when the clone fails', async () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        let installed = false
        const r = await offerLinkPackage({
            slug: 'foo',
            workspaceDir: dir,
            mode: 'accept',
            clone: () => false,
            install: () => {
                installed = true
                return true
            },
        })
        expect(r).toBe(true)
        expect(installed).toBe(false)
    })

    it('attach mode still returns true when install fails (intent already expressed)', async () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        writeWorkspaceJson(dir, ['app'])
        const r = await offerLinkPackage({
            slug: 'foo',
            workspaceDir: dir,
            mode: 'accept',
            clone: () => true,
            install: () => false,
        })
        expect(r).toBe(true)
    })
})

describe('realClone into a non-empty wrapper', () => {
    // Build a local git repo to act as the "workspace" remote, then clone it
    // into a wrapper that ALREADY holds a scaffolded <slug>/ subdir. No network.
    function makeLocalRepo(): string {
        const repo = mkdtempSync(join(tmpdir(), 'lp-remote-'))
        cleanups.push(repo)
        const git = (...args: string[]) => spawnSync('git', args, { cwd: repo, stdio: 'pipe', encoding: 'utf8' })
        git('init', '-q')
        git('config', 'user.email', 'test@example.com')
        git('config', 'user.name', 'Test')
        // The throwaway local repo must commit in CI/dev envs where the user's
        // global git config enables gpg signing but no key is available.
        git('config', 'commit.gpgsign', 'false')
        writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: '@tinycld/workspace', workspaces: ['app'] }))
        writeFileSync(join(repo, '.npmrc'), 'legacy-peer-deps=true\n')
        mkdirSync(join(repo, 'package-scripts'))
        writeFileSync(join(repo, 'package-scripts', 'index.js'), '// scripts\n')
        git('add', '-A')
        git('commit', '-q', '-m', 'initial')
        return repo
    }

    it('moves cloned contents (incl. .git) into the wrapper without clobbering the scaffolded slug dir', () => {
        const remote = makeLocalRepo()
        dir = mkdtempSync(join(tmpdir(), 'lp-wrapper-'))
        // Pre-existing scaffolded package the user just generated.
        mkdirSync(join(dir, 'my-feature'))
        writeFileSync(join(dir, 'my-feature', 'manifest.ts'), 'export default {}\n')

        const ok = realClone(remote, dir)
        expect(ok).toBe(true)

        // Workspace meta-repo files landed around the package.
        expect(existsSync(join(dir, 'package.json'))).toBe(true)
        expect(existsSync(join(dir, '.npmrc'))).toBe(true)
        expect(existsSync(join(dir, 'package-scripts', 'index.js'))).toBe(true)
        expect(existsSync(join(dir, '.git'))).toBe(true)
        // The scaffolded package dir is untouched.
        expect(readFileSync(join(dir, 'my-feature', 'manifest.ts'), 'utf-8')).toBe('export default {}\n')
        // The wrapper is now a real workspace root.
        expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name).toBe('@tinycld/workspace')
        // No temp clone dir left behind.
        expect(spawnSync('ls', [dir], { encoding: 'utf8' }).stdout).not.toContain('.tinycld-workspace-')
    })

    it('does not overwrite a pre-existing top-level file that collides with a repo entry', () => {
        const remote = makeLocalRepo()
        dir = mkdtempSync(join(tmpdir(), 'lp-wrapper-'))
        // User somehow already has a package.json in the wrapper — keep theirs.
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'pre-existing' }))

        const ok = realClone(remote, dir)
        expect(ok).toBe(true)
        expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).name).toBe('pre-existing')
        // Non-colliding entries still came through.
        expect(existsSync(join(dir, 'package-scripts', 'index.js'))).toBe(true)
    })

    it('returns false when the clone source is invalid', () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-wrapper-'))
        const ok = realClone(join(tmpdir(), `definitely-not-a-repo-${Date.now()}`), dir)
        expect(ok).toBe(false)
        // No leftover temp clone dir.
        expect(spawnSync('ls', [dir], { encoding: 'utf8' }).stdout).not.toContain('.tinycld-workspace-')
    })
})
