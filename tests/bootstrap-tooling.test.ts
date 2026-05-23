import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapTooling, copyWorkspaceTemplate, writeWorkspaceManifest } from '../src/bootstrap-tooling.ts'

let dir: string
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
})

/** A clone stub that records the cloned URLs and reports success. */
function makeCloneStub(recorded: string[]) {
    return (url: string, _dest: string): boolean => {
        recorded.push(url)
        return true
    }
}

describe('writeWorkspaceManifest', () => {
    it('writes a workspace package.json listing ALL possible members', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeWorkspaceManifest(dir)
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        // app + app/package-scripts + core + every feature, regardless of what's cloned.
        for (const m of [
            'app',
            'app/package-scripts',
            'core',
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
            'app/package-scripts',
            'core',
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

describe('copyWorkspaceTemplate', () => {
    it('lays down the root scaffolding from the real templates/workspace dir', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const written = copyWorkspaceTemplate(dir)
        // Real template files exist on disk under bootstrap/templates/workspace.
        expect(existsSync(join(dir, 'tinycld.packages.ts'))).toBe(true)
        expect(existsSync(join(dir, 'vitest.config.ts'))).toBe(true)
        expect(existsSync(join(dir, 'tests', 'unit-setup.ts'))).toBe(true)
        expect(written).toContain('tinycld.packages.ts')
        expect(written).toContain(join('tests', 'unit-setup.ts'))
    })

    it('never overwrites an existing file', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeFileSync(join(dir, 'tinycld.packages.ts'), 'export const packages = ["custom"]')
        const written = copyWorkspaceTemplate(dir)
        // Pre-existing file is preserved and NOT reported as written.
        expect(readFileSync(join(dir, 'tinycld.packages.ts'), 'utf-8')).toBe('export const packages = ["custom"]')
        expect(written).not.toContain('tinycld.packages.ts')
    })

    it('returns [] when the template dir is absent', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        expect(copyWorkspaceTemplate(dir, join(dir, 'no-such-templates'))).toEqual([])
    })
})

describe('bootstrapTooling (clone scope)', () => {
    it('clones ONLY app + core by default (no features, no workspace meta-repo)', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const urls: string[] = []
        const present = bootstrapTooling({ root: dir, clone: makeCloneStub(urls) })
        // No workspace clone: root scaffolding is generated, then app + core clone.
        const memberNames = urls.map((u) => u.split('/').pop()?.replace('.git', '') ?? '')
        expect(memberNames).toEqual(['app', 'core'])
        expect(present).not.toContain('workspace')
        expect(present).toContain('app')
        expect(present).toContain('core')
    })

    it('clones app + core + only the requested features (no workspace meta-repo)', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const urls: string[] = []
        bootstrapTooling({ root: dir, members: ['mail'], clone: makeCloneStub(urls) })
        const memberNames = urls.map((u) => u.split('/').pop()?.replace('.git', '') ?? '')
        expect(memberNames).toEqual(['app', 'core', 'mail'])
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

describe('bootstrapTooling (no workspace meta-repo clone)', () => {
    it('NEVER clones a workspace meta-repo — root scaffolding is generated', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const urls: string[] = []
        bootstrapTooling({ root: dir, repoBase: 'git@github.com:tinycld', clone: makeCloneStub(urls) })
        // No /workspace.git clone at all.
        expect(urls.some((u) => u.includes('/workspace.git'))).toBe(false)
        // app + core are still cloned.
        expect(urls).toContain('git@github.com:tinycld/app.git')
        expect(urls).toContain('git@github.com:tinycld/core.git')
    })

    it("never adds 'workspace' to present[]", () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const present = bootstrapTooling({ root: dir, clone: makeCloneStub([]) })
        expect(present).not.toContain('workspace')
        expect(present[0]).not.toBe('workspace')
    })

    it('generates the root manifest + lays down the template scaffolding', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        bootstrapTooling({ root: dir, clone: makeCloneStub([]) })
        // writeWorkspaceManifest output
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        expect(pkg.name).toBe('@tinycld/workspace')
        expect(pkg.workspaces).toContain('app/package-scripts')
        // copyWorkspaceTemplate output
        expect(existsSync(join(dir, 'tinycld.packages.ts'))).toBe(true)
        expect(existsSync(join(dir, 'vitest.config.ts'))).toBe(true)
        expect(existsSync(join(dir, 'tests', 'unit-setup.ts'))).toBe(true)
        expect(existsSync(join(dir, '.node-version'))).toBe(true)
        expect(existsSync(join(dir, '.go-version'))).toBe(true)
    })

    it('does not overwrite pre-existing root scaffolding (e.g. a real checkout / CI-provided file)', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeFileSync(join(dir, 'tinycld.packages.ts'), 'export const packages = ["custom"]')
        bootstrapTooling({ root: dir, clone: makeCloneStub([]) })
        expect(readFileSync(join(dir, 'tinycld.packages.ts'), 'utf-8')).toBe('export const packages = ["custom"]')
    })
})
