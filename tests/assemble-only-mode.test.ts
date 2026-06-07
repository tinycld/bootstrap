import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runAssembleOnly } from '../src/index.ts'

let dir: string
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
})

/** Clone stub that records the cloned URLs and reports success. */
function makeCloneStub(recorded: string[]) {
    return (url: string, _dest: string): boolean => {
        recorded.push(url)
        return true
    }
}

describe('runAssembleOnly', () => {
    it('writes the workspace manifest and clones via the injected runner', () => {
        dir = mkdtempSync(join(tmpdir(), 'tool-'))
        const urls: string[] = []
        runAssembleOnly({
            root: dir,
            members: ['contacts'],
            clone: makeCloneStub(urls),
        })
        expect(existsSync(join(dir, 'package.json'))).toBe(true)
        // No workspace meta-repo clone: root manifest is generated, then the
        // single tinycld member + the requested feature clone.
        const memberNames = urls.map((u) => u.split('/').pop()?.replace('.git', '') ?? '')
        expect(memberNames).toEqual(['tinycld', 'contacts'])
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        expect(pkg.workspaces).toContain('tinycld/package-scripts')
    })

    it('throws if the required tinycld member fails to clone', () => {
        dir = mkdtempSync(join(tmpdir(), 'tool-'))
        // clone fails for tinycld → guard must throw
        expect(() =>
            runAssembleOnly({
                root: dir,
                clone: (_url, dest) => !dest.endsWith('/tinycld'),
            })
        ).toThrow(/required member 'tinycld'/)
    })

    it('peels tinycld@ref out of --with into a pinned clone, keeps feature pins', () => {
        dir = mkdtempSync(join(tmpdir(), 'tool-'))
        const calls: { url: string; ref?: string }[] = []
        const refStub = (url: string, _dest: string, ref?: string): boolean => {
            calls.push({ url, ref })
            return true
        }
        runAssembleOnly({
            root: dir,
            members: ['tinycld@v1.0.0', 'mail@v3.0.0', 'contacts'],
            clone: refStub,
        })
        expect(calls.find((c) => c.url.endsWith('/tinycld.git'))?.ref).toBe('v1.0.0')
        expect(calls.find((c) => c.url.endsWith('/mail.git'))?.ref).toBe('v3.0.0')
        expect(calls.find((c) => c.url.endsWith('/contacts.git'))?.ref).toBeUndefined()
    })

    it('uses TINYCLD_REPO_BASE from the environment for clone URLs', () => {
        dir = mkdtempSync(join(tmpdir(), 'tool-'))
        const urls: string[] = []
        const prev = process.env.TINYCLD_REPO_BASE
        process.env.TINYCLD_REPO_BASE = 'https://github.com/tinycld'
        try {
            runAssembleOnly({
                root: dir,
                clone: makeCloneStub(urls),
            })
        } finally {
            if (prev === undefined) delete process.env.TINYCLD_REPO_BASE
            else process.env.TINYCLD_REPO_BASE = prev
        }
        // tinycld cloned via the HTTPS base from the env var, not the SSH default
        // (no workspace meta-repo clone)
        expect(urls).toEqual(['https://github.com/tinycld/tinycld.git'])
    })
})
