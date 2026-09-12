import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { getPackages, resetPackagesCache } from '../tinycld.packages'

// Build a fake workspace tree and point getPackages at it via TINYCLD_WS_ROOT.
function makeWorkspace(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tcld-ws-'))
    // core member: package.json name @tinycld/core, NO manifest.ts
    fs.mkdirSync(path.join(root, 'core'), { recursive: true })
    fs.writeFileSync(
        path.join(root, 'core', 'package.json'),
        JSON.stringify({ name: '@tinycld/core' })
    )
    // feature member: contacts with manifest.ts + named package.json
    fs.mkdirSync(path.join(root, 'contacts'), { recursive: true })
    fs.writeFileSync(path.join(root, 'contacts', 'manifest.ts'), 'export default {}')
    fs.writeFileSync(
        path.join(root, 'contacts', 'package.json'),
        JSON.stringify({ name: '@tinycld/contacts' })
    )
    // app shell: package.json name "app", NO manifest.ts
    fs.mkdirSync(path.join(root, 'app'), { recursive: true })
    fs.writeFileSync(path.join(root, 'app', 'package.json'), JSON.stringify({ name: 'app' }))
    return root
}

describe('getPackages (new layout)', () => {
    let root: string
    beforeEach(() => {
        root = makeWorkspace()
        process.env.TINYCLD_WS_ROOT = root
        resetPackagesCache()
    })
    afterEach(() => {
        delete process.env.TINYCLD_WS_ROOT
        fs.rmSync(root, { recursive: true, force: true })
    })

    it('includes core (member named @tinycld/core, no manifest) plus feature members with a manifest.ts', () => {
        const pkgs = getPackages()
        expect(pkgs).toContain('@tinycld/core')
        expect(pkgs).toContain('@tinycld/contacts')
    })

    it('excludes the app shell (named "app", no manifest.ts)', () => {
        expect(getPackages()).not.toContain('app')
    })

    it('lists core first (stable order: core, then features sorted)', () => {
        expect(getPackages()[0]).toBe('@tinycld/core')
    })
})

// A member may live one level down inside a dir that is NOT itself a member:
// hosting/ui, whose parent ships Go only and is deliberately kept out of the
// workspace, so its client surface stays in the hosting repo rather than
// needing one of its own.
describe('getPackages (nested members)', () => {
    let root: string
    beforeEach(() => {
        root = makeWorkspace()
        process.env.TINYCLD_WS_ROOT = root
        resetPackagesCache()
    })
    afterEach(() => {
        delete process.env.TINYCLD_WS_ROOT
        fs.rmSync(root, { recursive: true, force: true })
    })

    it('finds a member nested inside a non-member parent', () => {
        const ui = path.join(root, 'hosting', 'ui')
        fs.mkdirSync(ui, { recursive: true })
        fs.writeFileSync(path.join(ui, 'manifest.ts'), 'export default {}')
        fs.writeFileSync(path.join(ui, 'package.json'), JSON.stringify({ name: '@tinycld/host-ui' }))
        // The parent itself is not a member: no manifest.ts of its own.
        fs.writeFileSync(path.join(root, 'hosting', 'go.mod'), 'module example.test\n')

        resetPackagesCache()
        expect(getPackages()).toContain('@tinycld/host-ui')
    })

    it('does not descend into a dir that is itself a member', () => {
        // A feature's own subdirectory is its source tree, not another member.
        const inner = path.join(root, 'contacts', 'vendored')
        fs.mkdirSync(inner, { recursive: true })
        fs.writeFileSync(path.join(inner, 'manifest.ts'), 'export default {}')
        fs.writeFileSync(
            path.join(inner, 'package.json'),
            JSON.stringify({ name: '@tinycld/should-not-appear' })
        )

        resetPackagesCache()
        expect(getPackages()).not.toContain('@tinycld/should-not-appear')
    })

    it('lists each member once when a nested scan revisits the tree', () => {
        resetPackagesCache()
        const pkgs = getPackages()
        expect(new Set(pkgs).size).toBe(pkgs.length)
    })
})
