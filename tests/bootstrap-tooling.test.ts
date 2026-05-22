import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapTooling, writeWorkspaceManifest } from '../src/bootstrap-tooling.ts'

let dir: string
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
})

/**
 * A clone stub that auto-writes a @tinycld/workspace package.json into the
 * destination when the URL ends with /workspace.git. This lets the workspace-
 * root guard see a valid root after the stub "clones" the workspace repo.
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

describe('writeWorkspaceManifest', () => {
    it('writes a workspace package.json listing ALL possible members', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeWorkspaceManifest(dir)
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        // app + core + package-scripts + every feature, regardless of what's cloned.
        for (const m of [
            'app',
            'core',
            'package-scripts',
            'contacts',
            'mail',
            'calendar',
            'drive',
            'calc',
            'text',
            'google-takeout-import',
        ]) {
            expect(pkg.workspaces).toContain(m)
        }
    })

    it('writes an .npmrc with legacy-peer-deps', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeWorkspaceManifest(dir)
        expect(existsSync(join(dir, '.npmrc'))).toBe(true)
        expect(readFileSync(join(dir, '.npmrc'), 'utf-8')).toContain('legacy-peer-deps=true')
    })

    it('has no duplicate workspace entries', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeWorkspaceManifest(dir)
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        expect(new Set(pkg.workspaces).size).toBe(pkg.workspaces.length)
    })

    it('merges into an existing package.json — extra fields survive, workspaces + postinstall always correct', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const existing = {
            name: '@tinycld/workspace',
            version: '1.2.3',
            private: true,
            type: 'module',
            devDependencies: { typescript: '^5.0.0' },
            engines: { node: '>=20' },
            scripts: { prepare: 'echo hi', postinstall: 'old-postinstall' },
            workspaces: ['app', 'core'],
        }
        writeFileSync(join(dir, 'package.json'), JSON.stringify(existing))
        writeWorkspaceManifest(dir)
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        // Extra fields survive
        expect(pkg.devDependencies).toEqual({ typescript: '^5.0.0' })
        expect(pkg.engines).toEqual({ node: '>=20' })
        // Extra script survives
        expect(pkg.scripts.prepare).toBe('echo hi')
        // postinstall is always enforced to the canonical value
        expect(pkg.scripts.postinstall).toBe('cd app && npm run packages:generate && npm run assets:copy-pdfjs')
        // workspaces is always the full canonical list
        for (const m of [
            'app',
            'core',
            'package-scripts',
            'contacts',
            'mail',
            'calendar',
            'drive',
            'calc',
            'text',
            'google-takeout-import',
        ]) {
            expect(pkg.workspaces).toContain(m)
        }
        expect(new Set(pkg.workspaces).size).toBe(pkg.workspaces.length)
    })

    it('writes the full generated manifest when no package.json exists yet', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeWorkspaceManifest(dir)
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        expect(pkg.name).toBe('@tinycld/workspace')
        expect(pkg.version).toBe('0.0.0')
        expect(pkg.scripts.postinstall).toBe('cd app && npm run packages:generate && npm run assets:copy-pdfjs')
    })

    it('does not overwrite an existing .npmrc', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeFileSync(join(dir, '.npmrc'), 'custom-setting=true\n')
        writeWorkspaceManifest(dir)
        expect(readFileSync(join(dir, '.npmrc'), 'utf-8')).toBe('custom-setting=true\n')
    })

    it('writes the default .npmrc when none exists', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeWorkspaceManifest(dir)
        expect(readFileSync(join(dir, '.npmrc'), 'utf-8')).toContain('legacy-peer-deps=true')
    })
})

describe('bootstrapTooling (clone scope)', () => {
    it('clones ONLY app + core by default (no features)', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const urls: string[] = []
        const present = bootstrapTooling({ root: dir, clone: makeCloneStub(urls) })
        // workspace is cloned first (self-init), then app + core
        const memberNames = urls.map((u) => u.split('/').pop()?.replace('.git', '') ?? '')
        expect(memberNames).toEqual(['workspace', 'app', 'core'])
        expect(present).toContain('workspace')
        expect(present).toContain('app')
        expect(present).toContain('core')
    })

    it('clones app + core + only the requested features', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const urls: string[] = []
        bootstrapTooling({ root: dir, members: ['mail'], clone: makeCloneStub(urls) })
        const memberNames = urls.map((u) => u.split('/').pop()?.replace('.git', '') ?? '')
        expect(memberNames).toEqual(['workspace', 'app', 'core', 'mail'])
    })

    it('throws on an unknown feature member', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        expect(() => bootstrapTooling({ root: dir, members: ['nope'], clone: () => true })).toThrow(/Unknown feature/)
    })

    it('still validates the NAME part when a member carries an @ref', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        expect(() => bootstrapTooling({ root: dir, members: ['nope@v1.0.0'], clone: () => true })).toThrow(
            /Unknown feature/
        )
    })
})

describe('bootstrapTooling (tag pinning)', () => {
    // Records (url, ref) per clone so we can assert which ref each member is pinned to.
    function makeRefStub(calls: { url: string; ref?: string }[]) {
        return (url: string, dest: string, ref?: string): boolean => {
            calls.push({ url, ref })
            if (url.endsWith('/workspace.git')) {
                writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: '@tinycld/workspace' }))
            }
            return true
        }
    }

    it('clones a feature member at the ref given in --with name@ref', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const calls: { url: string; ref?: string }[] = []
        bootstrapTooling({ root: dir, members: ['contacts@v1.2.3', 'mail'], clone: makeRefStub(calls) })
        const contacts = calls.find((c) => c.url.endsWith('/contacts.git'))
        const mail = calls.find((c) => c.url.endsWith('/mail.git'))
        expect(contacts?.ref).toBe('v1.2.3')
        // mail has no @ref → clones HEAD (undefined ref)
        expect(mail?.ref).toBeUndefined()
    })

    it('pins app and core via appRef / coreRef options', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const calls: { url: string; ref?: string }[] = []
        bootstrapTooling({ root: dir, appRef: 'v2.0.0', coreRef: 'v3.1.0', clone: makeRefStub(calls) })
        expect(calls.find((c) => c.url.endsWith('/app.git'))?.ref).toBe('v2.0.0')
        expect(calls.find((c) => c.url.endsWith('/core.git'))?.ref).toBe('v3.1.0')
    })

    it('dedupes a member given both bare and with @ref (clones once, pinned)', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const calls: { url: string; ref?: string }[] = []
        bootstrapTooling({ root: dir, members: ['contacts', 'contacts@v1.2.3'], clone: makeRefStub(calls) })
        const contactsClones = calls.filter((c) => c.url.endsWith('/contacts.git'))
        expect(contactsClones).toHaveLength(1)
    })

    it('returns the bare member NAME (not name@ref) in present[]', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const present = bootstrapTooling({
            root: dir,
            members: ['contacts@v1.2.3'],
            clone: makeRefStub([]),
        })
        expect(present).toContain('contacts')
        expect(present).not.toContain('contacts@v1.2.3')
    })
})

describe('bootstrapTooling (workspace self-init)', () => {
    it('clones workspace repo FIRST when root is not already a workspace root', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const urls: string[] = []
        bootstrapTooling({ root: dir, repoBase: 'git@github.com:tinycld', clone: makeCloneStub(urls) })
        // First cloned URL must be the workspace meta-repo
        expect(urls[0]).toContain('/workspace.git')
        // Must include app and core after
        expect(urls).toContain('git@github.com:tinycld/app.git')
        expect(urls).toContain('git@github.com:tinycld/core.git')
    })

    it('does NOT clone workspace when root is already a workspace root', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        // Pre-write a valid workspace root package.json
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@tinycld/workspace' }))
        const urls: string[] = []
        bootstrapTooling({ root: dir, clone: makeCloneStub(urls) })
        // No workspace.git clone
        expect(urls.some((u) => u.includes('/workspace.git'))).toBe(false)
        // Still clones app + core
        const memberNames = urls.map((u) => u.split('/').pop()?.replace('.git', '') ?? '')
        expect(memberNames).toContain('app')
        expect(memberNames).toContain('core')
    })

    it("adds 'workspace' to returned present[] when workspace is cloned", () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const present = bootstrapTooling({ root: dir, clone: makeCloneStub([]) })
        expect(present[0]).toBe('workspace')
    })

    it("does NOT add 'workspace' to present[] when root is already a workspace root", () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@tinycld/workspace' }))
        const present = bootstrapTooling({ root: dir, clone: makeCloneStub([]) })
        expect(present).not.toContain('workspace')
    })

    it("does NOT add 'workspace' to present[] when workspace clone fails, but still proceeds to write manifest + attempt app/core", () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const urls: string[] = []
        const cloneStub = (url: string, dest: string): boolean => {
            urls.push(url)
            if (url.endsWith('/workspace.git')) return false
            // app/core succeed; real git clone creates dest — stub must do the same
            mkdirSync(dest, { recursive: true })
            writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: url }))
            return true
        }
        const present = bootstrapTooling({ root: dir, clone: cloneStub })
        // workspace clone failed — must not appear in present[]
        expect(present).not.toContain('workspace')
        // bootstrapTooling must still attempt app and core
        expect(urls.some((u) => u.endsWith('/app.git'))).toBe(true)
        expect(urls.some((u) => u.endsWith('/core.git'))).toBe(true)
        // app and core succeeded, so they appear in present[]
        expect(present).toContain('app')
        expect(present).toContain('core')
    })

    it('preserves pre-existing subdirs in root when cloning workspace into non-empty dir', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        // Simulate the link-package bootstrap flow: root already contains a <slug>/ subdir
        mkdirSync(join(dir, 'my-package'))
        writeFileSync(join(dir, 'my-package', 'manifest.ts'), 'export default {}')

        // Clone stub that actually writes files into dest when cloning workspace,
        // including one that would collide with an existing root entry
        const collisionStub = (url: string, dest: string): boolean => {
            if (url.endsWith('/workspace.git')) {
                // Write workspace package.json (required for root guard)
                writeFileSync(join(dest, 'package.json'), JSON.stringify({ name: '@tinycld/workspace' }))
                // Write a non-colliding new file
                writeFileSync(join(dest, 'tinycld.packages.ts'), 'export const packages = []')
                // Write an entry that collides with an existing subdir
                mkdirSync(join(dest, 'my-package'))
                writeFileSync(join(dest, 'my-package', 'intruder.ts'), 'should not overwrite')
            }
            return true
        }

        bootstrapTooling({ root: dir, clone: collisionStub })

        // The original file inside my-package is preserved
        expect(readFileSync(join(dir, 'my-package', 'manifest.ts'), 'utf-8')).toBe('export default {}')
        // The new file from workspace was moved in
        expect(existsSync(join(dir, 'tinycld.packages.ts'))).toBe(true)
        // The colliding entry (my-package/) was NOT overwritten — intruder.ts absent
        expect(existsSync(join(dir, 'my-package', 'intruder.ts'))).toBe(false)
    })
})
