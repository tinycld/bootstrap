import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleWorkspace, copyWorkspaceTemplate, writeWorkspaceManifest } from '../src/assemble-workspace.ts'

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
        // tinycld (merged app shell + core) + its nested members + every
        // feature, regardless of what's cloned.
        for (const m of [
            'tinycld',
            'tinycld/core',
            'tinycld/package-scripts',
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

    it('writes a pnpm-workspace.yaml with the member list + pnpm settings', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeWorkspaceManifest(dir)
        expect(existsSync(join(dir, 'pnpm-workspace.yaml'))).toBe(true)
        const yaml = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf-8')
        expect(yaml).toContain('nodeLinker: hoisted')
        expect(yaml).toContain('packages:')
        expect(yaml).toContain('  - tinycld')
        expect(yaml).toContain('  - tinycld/core')
    })

    it('self-registers a manifest-bearing member present on disk but absent from ALL_MEMBERS', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        // Simulate a CI / custom-package checkout: a member dir with a
        // package.json + manifest.ts that bootstrap doesn't know about.
        mkdirSync(join(dir, 'calendar-slots'))
        writeFileSync(join(dir, 'calendar-slots', 'package.json'), JSON.stringify({ name: '@tinycld/calendar-slots' }))
        writeFileSync(join(dir, 'calendar-slots', 'manifest.ts'), 'export default {}')
        // A non-member dir (no manifest) must NOT be registered.
        mkdirSync(join(dir, 'scratch'))
        writeFileSync(join(dir, 'scratch', 'package.json'), JSON.stringify({ name: 'scratch' }))
        writeWorkspaceManifest(dir)

        // Authoritative source pnpm reads: the member must land in pnpm-workspace.yaml.
        const yaml = readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf-8')
        expect(yaml).toContain('  - calendar-slots')
        expect(yaml).not.toContain('  - scratch')

        // The package.json `workspaces` hint stays in sync (no duplicates).
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        expect(pkg.workspaces).toContain('calendar-slots')
        expect(pkg.workspaces).not.toContain('scratch')
        expect(new Set(pkg.workspaces).size).toBe(pkg.workspaces.length)
    })

    it('pins packageManager + adds the tsx devDep', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeWorkspaceManifest(dir)
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        expect(pkg.packageManager).toMatch(/^pnpm@/)
        expect(pkg.devDependencies.tsx).toBeTruthy()
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
            workspaces: ['tinycld', 'tinycld/core'],
        }
        writeFileSync(join(dir, 'package.json'), JSON.stringify(existing))
        writeWorkspaceManifest(dir)
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        // Extra devDeps survive; bootstrap adds tsx (needed by the postinstall).
        expect(pkg.devDependencies.typescript).toBe('^5.0.0')
        expect(pkg.devDependencies.tsx).toBeTruthy()
        expect(pkg.engines).toEqual({ node: '>=20' })
        // Extra script survives
        expect(pkg.scripts.prepare).toBe('echo hi')
        // postinstall is always enforced to the canonical value
        expect(pkg.scripts.postinstall).toBe(
            'tsx scripts/link-members.ts && cd tinycld && pnpm run packages:generate && cd .. && tsx scripts/link-members.ts && cd tinycld && pnpm run assets:copy-pdfjs'
        )
        // workspaces is always the full canonical list
        for (const m of [
            'tinycld',
            'tinycld/core',
            'tinycld/package-scripts',
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
        expect(pkg.scripts.postinstall).toBe(
            'tsx scripts/link-members.ts && cd tinycld && pnpm run packages:generate && cd .. && tsx scripts/link-members.ts && cd tinycld && pnpm run assets:copy-pdfjs'
        )
    })

    it('does not overwrite an existing .npmrc', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeFileSync(join(dir, '.npmrc'), 'custom-setting=true\n')
        writeWorkspaceManifest(dir)
        expect(readFileSync(join(dir, '.npmrc'), 'utf-8')).toBe('custom-setting=true\n')
    })

    it('writes a minimal .npmrc (pnpm settings live in pnpm-workspace.yaml) when none exists', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        writeWorkspaceManifest(dir)
        expect(readFileSync(join(dir, '.npmrc'), 'utf-8')).toContain('pnpm-workspace.yaml')
    })
})

describe('copyWorkspaceTemplate', () => {
    it('lays down the complete root scaffolding from the real templates/workspace dir', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const written = copyWorkspaceTemplate(dir)
        // Every file the workspace root needs, including the version dotfiles
        // (CI reads ws/.node-version + ws/.go-version) and all tests/ stubs.
        // readdirSync includes dotfiles, so they must come through.
        const expected = [
            '.node-version',
            '.go-version',
            'tinycld.packages.ts',
            'vitest.config.ts',
            join('scripts', 'link-members.ts'),
            join('tests', 'expo-clipboard-stub.ts'),
            join('tests', 'expo-router-stub.ts'),
            join('tests', 'lucide-react-native-stub.cjs'),
            join('tests', 'tinycld.packages.test.ts'),
            join('tests', 'unit-setup.ts'),
        ]
        for (const rel of expected) {
            expect(existsSync(join(dir, rel)), `${rel} on disk`).toBe(true)
            expect(written, `${rel} reported written`).toContain(rel)
        }
        // No silent extras/drops: the written set is exactly the template set.
        expect(written.sort()).toEqual([...expected].sort())
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

describe('assembleWorkspace (clone scope)', () => {
    it('clones ONLY the tinycld member by default (no features, no workspace meta-repo)', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const urls: string[] = []
        const present = assembleWorkspace({ root: dir, clone: makeCloneStub(urls) })
        // No workspace clone: root scaffolding is generated, then the single
        // tinycld repo (merged app shell + core) clones.
        const memberNames = urls.map((u) => u.split('/').pop()?.replace('.git', '') ?? '')
        expect(memberNames).toEqual(['tinycld'])
        expect(present).not.toContain('workspace')
        expect(present).toContain('tinycld')
    })

    it('clones tinycld + only the requested features (no workspace meta-repo)', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const urls: string[] = []
        assembleWorkspace({ root: dir, members: ['mail'], clone: makeCloneStub(urls) })
        const memberNames = urls.map((u) => u.split('/').pop()?.replace('.git', '') ?? '')
        expect(memberNames).toEqual(['tinycld', 'mail'])
    })

    it('throws on an unknown feature member', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        expect(() => assembleWorkspace({ root: dir, members: ['nope'], clone: () => true })).toThrow(/Unknown feature/)
    })

    it('still validates the NAME part when a member carries an @ref', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        expect(() => assembleWorkspace({ root: dir, members: ['nope@v1.0.0'], clone: () => true })).toThrow(
            /Unknown feature/
        )
    })

    // The tinycld-anchored CI/release flow checks out the merged repo into
    // ws/tinycld BEFORE running bootstrap, so the workspace root already contains
    // the tinycld member. bootstrap must NOT re-clone it (that would clobber the
    // pinned checkout) but must still record it present and clone everything else
    // around it.
    it('skips re-cloning a member already checked out at the root (e.g. CI tinycld pre-checkout)', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        // Simulate the CI checkout: ws/tinycld already present with a package.json.
        mkdirSync(join(dir, 'tinycld'))
        writeFileSync(join(dir, 'tinycld', 'package.json'), JSON.stringify({ name: 'tinycld', version: 'pinned' }))
        const urls: string[] = []
        const present = assembleWorkspace({ root: dir, members: ['mail'], clone: makeCloneStub(urls) })
        const cloned = urls.map((u) => u.split('/').pop()?.replace('.git', '') ?? '')
        // tinycld is NOT re-cloned...
        expect(cloned).not.toContain('tinycld')
        // ...but the requested feature is.
        expect(cloned).toEqual(['mail'])
        // tinycld is still recorded present alongside the freshly cloned members.
        expect(present).toContain('tinycld')
        expect(present).toContain('mail')
        // The pre-checkout's package.json is untouched (not overwritten by a clone).
        expect(JSON.parse(readFileSync(join(dir, 'tinycld', 'package.json'), 'utf-8')).version).toBe('pinned')
    })
})

describe('assembleWorkspace (tag pinning)', () => {
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
        assembleWorkspace({ root: dir, members: ['contacts@v1.2.3', 'mail'], clone: makeRefStub(calls) })
        const contacts = calls.find((c) => c.url.endsWith('/contacts.git'))
        const mail = calls.find((c) => c.url.endsWith('/mail.git'))
        expect(contacts?.ref).toBe('v1.2.3')
        // mail has no @ref → clones HEAD (undefined ref)
        expect(mail?.ref).toBeUndefined()
    })

    it('pins the tinycld member via the tinycldRef option', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const calls: { url: string; ref?: string }[] = []
        assembleWorkspace({ root: dir, tinycldRef: 'v2.0.0', clone: makeRefStub(calls) })
        expect(calls.find((c) => c.url.endsWith('/tinycld.git'))?.ref).toBe('v2.0.0')
    })

    it('dedupes a member given both bare and with @ref (clones once, pinned)', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const calls: { url: string; ref?: string }[] = []
        assembleWorkspace({ root: dir, members: ['contacts', 'contacts@v1.2.3'], clone: makeRefStub(calls) })
        const contactsClones = calls.filter((c) => c.url.endsWith('/contacts.git'))
        expect(contactsClones).toHaveLength(1)
    })

    it('returns the bare member NAME (not name@ref) in present[]', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const present = assembleWorkspace({
            root: dir,
            members: ['contacts@v1.2.3'],
            clone: makeRefStub([]),
        })
        expect(present).toContain('contacts')
        expect(present).not.toContain('contacts@v1.2.3')
    })
})

describe('assembleWorkspace (no workspace meta-repo clone)', () => {
    it('NEVER clones a workspace meta-repo — root scaffolding is generated', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const urls: string[] = []
        assembleWorkspace({ root: dir, repoBase: 'git@github.com:tinycld', clone: makeCloneStub(urls) })
        // No /workspace.git clone at all.
        expect(urls.some((u) => u.includes('/workspace.git'))).toBe(false)
        // The single tinycld member (merged app shell + core) is still cloned.
        expect(urls).toContain('git@github.com:tinycld/tinycld.git')
    })

    it("never adds 'workspace' to present[]", () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const present = assembleWorkspace({ root: dir, clone: makeCloneStub([]) })
        expect(present).not.toContain('workspace')
        expect(present[0]).not.toBe('workspace')
    })

    it('generates the root manifest + lays down the template scaffolding', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        assembleWorkspace({ root: dir, clone: makeCloneStub([]) })
        // writeWorkspaceManifest output
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        expect(pkg.name).toBe('@tinycld/workspace')
        expect(pkg.workspaces).toContain('tinycld/package-scripts')
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
        assembleWorkspace({ root: dir, clone: makeCloneStub([]) })
        expect(readFileSync(join(dir, 'tinycld.packages.ts'), 'utf-8')).toBe('export const packages = ["custom"]')
    })
})
