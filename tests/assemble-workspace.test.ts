import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assembleWorkspace, copyWorkspaceTemplate } from '../src/assemble-workspace.ts'

let dir: string
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
})

/**
 * Materialize a no-op root-writer script inside a fake `tinycld` clone so
 * delegateWorkspaceRoot's contract is satisfied without asserting on what it
 * writes — these stubs exist to test clone SCOPE (which repos got cloned),
 * not delegation content (covered by the `assembleWorkspace delegation` suite
 * below).
 */
function writeNoopRootWriter(dest: string): void {
    mkdirSync(join(dest, 'scripts'), { recursive: true })
    if (!existsSync(join(dest, 'package.json'))) {
        writeFileSync(join(dest, 'package.json'), '{"name":"tinycld","type":"module"}')
    }
    writeFileSync(join(dest, 'scripts', 'write-workspace-root.ts'), '')
}

/** A clone stub that records the cloned URLs and reports success. */
function makeCloneStub(recorded: string[]) {
    return (url: string, dest: string): boolean => {
        recorded.push(url)
        if (url.endsWith('/tinycld.git')) writeNoopRootWriter(dest)
        return true
    }
}

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
            join('tests', 'expo-image-stub.tsx'),
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
        // Simulate the CI checkout: ws/tinycld already present with a package.json
        // and the root-writer script (a real checkout carries it).
        mkdirSync(join(dir, 'tinycld'))
        writeFileSync(join(dir, 'tinycld', 'package.json'), JSON.stringify({ name: 'tinycld', version: 'pinned' }))
        writeNoopRootWriter(join(dir, 'tinycld'))
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
            if (url.endsWith('/tinycld.git')) writeNoopRootWriter(dest)
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

    it('lays down the template scaffolding before delegating to the cloned root-writer', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        assembleWorkspace({ root: dir, clone: makeCloneStub([]) })
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

// A clone fake that materializes a minimal tinycld repo carrying a
// root-writer script which records its invocation. The fake repo's
// package.json declares "type":"module" so bare `node` runs the stub .ts
// file as ESM (matching the real tinycld repo, which is type:module).
function fakeCloneWithRootWriter(url: string, dest: string): boolean {
    mkdirSync(join(dest, 'scripts'), { recursive: true })
    writeFileSync(join(dest, 'package.json'), '{"name":"tinycld","type":"module"}')
    if (url.endsWith('/tinycld.git')) {
        writeFileSync(
            join(dest, 'scripts', 'write-workspace-root.ts'),
            "import fs from 'node:fs'\nfs.writeFileSync('root-writer-ran.txt', 'yes')\n"
        )
    }
    return true
}

describe('assembleWorkspace delegation', () => {
    it('runs the cloned root-writer after cloning', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        assembleWorkspace({ root: dir, clone: fakeCloneWithRootWriter })
        expect(readFileSync(join(dir, 'root-writer-ran.txt'), 'utf8')).toBe('yes')
    })

    it('fails with a clear message when the cloned tinycld predates the root-writer', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const cloneWithoutWriter = (_url: string, dest: string): boolean => {
            mkdirSync(dest, { recursive: true })
            writeFileSync(join(dest, 'package.json'), '{"name":"tinycld"}')
            return true
        }
        expect(() => assembleWorkspace({ root: dir, clone: cloneWithoutWriter })).toThrow(
            /write-workspace-root\.ts.*tinycldRef|older bootstrap/
        )
    })

    it('does not write pnpm-workspace.yaml itself before delegation', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const failingClone = (): boolean => false
        assembleWorkspace({ root: dir, clone: failingClone })
        expect(existsSync(join(dir, 'pnpm-workspace.yaml'))).toBe(false)
        expect(existsSync(join(dir, 'package.json'))).toBe(false)
    })
})
