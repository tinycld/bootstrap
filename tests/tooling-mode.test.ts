import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runToolingMode } from '../src/index.ts'

let dir: string
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
})

/**
 * Clone stub that writes a @tinycld/workspace package.json when the URL ends
 * with /workspace.git so the workspace-root guard passes on subsequent checks.
 */
function makeCloneStub(recorded: string[]) {
    return (url: string, dest: string): boolean => {
        recorded.push(url)
        if (url.endsWith('/workspace.git')) {
            writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: '@tinycld/workspace' }))
        }
        return true
    }
}

describe('runToolingMode', () => {
    it('writes the workspace manifest and clones via the injected runner', () => {
        dir = mkdtempSync(join(tmpdir(), 'tool-'))
        const urls: string[] = []
        runToolingMode({
            root: dir,
            members: ['contacts'],
            clone: makeCloneStub(urls),
        })
        expect(existsSync(join(dir, 'package.json'))).toBe(true)
        // workspace is cloned first, then app + core + requested feature
        const memberNames = urls.map((u) => u.split('/').pop()?.replace('.git', '') ?? '')
        expect(memberNames).toEqual(['workspace', 'app', 'core', 'contacts'])
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        expect(pkg.workspaces).toContain('package-scripts')
    })

    it('throws if a required member (app/core) fails to clone', () => {
        dir = mkdtempSync(join(tmpdir(), 'tool-'))
        // clone succeeds only for core → app is missing → guard must throw
        expect(() =>
            runToolingMode({
                root: dir,
                clone: (url, dest) => {
                    // Let workspace clone succeed (write its package.json so guard passes)
                    if (url.endsWith('/workspace.git')) {
                        writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: '@tinycld/workspace' }))
                        return true
                    }
                    return dest.endsWith('/core')
                },
            })
        ).toThrow(/required member 'app'/)
    })

    it('peels app@ref / core@ref out of --with into pinned clones, keeps feature pins', () => {
        dir = mkdtempSync(join(tmpdir(), 'tool-'))
        const calls: { url: string; ref?: string }[] = []
        const refStub = (url: string, dest: string, ref?: string): boolean => {
            calls.push({ url, ref })
            if (url.endsWith('/workspace.git')) {
                writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: '@tinycld/workspace' }))
            }
            return true
        }
        runToolingMode({
            root: dir,
            members: ['app@v1.0.0', 'core@v2.0.0', 'mail@v3.0.0', 'contacts'],
            clone: refStub,
        })
        expect(calls.find((c) => c.url.endsWith('/app.git'))?.ref).toBe('v1.0.0')
        expect(calls.find((c) => c.url.endsWith('/core.git'))?.ref).toBe('v2.0.0')
        expect(calls.find((c) => c.url.endsWith('/mail.git'))?.ref).toBe('v3.0.0')
        expect(calls.find((c) => c.url.endsWith('/contacts.git'))?.ref).toBeUndefined()
    })

    it('uses TINYCLD_REPO_BASE from the environment for clone URLs', () => {
        dir = mkdtempSync(join(tmpdir(), 'tool-'))
        const urls: string[] = []
        const prev = process.env.TINYCLD_REPO_BASE
        process.env.TINYCLD_REPO_BASE = 'https://github.com/tinycld'
        try {
            runToolingMode({
                root: dir,
                clone: makeCloneStub(urls),
            })
        } finally {
            if (prev === undefined) delete process.env.TINYCLD_REPO_BASE
            else process.env.TINYCLD_REPO_BASE = prev
        }
        // workspace + app + core cloned via the HTTPS base from the env var, not the SSH default
        expect(urls).toEqual([
            'https://github.com/tinycld/workspace.git',
            'https://github.com/tinycld/app.git',
            'https://github.com/tinycld/core.git',
        ])
    })
})
