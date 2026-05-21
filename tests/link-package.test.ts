import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ensureMember, offerLinkPackage } from '../src/link-package.ts'

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
    it('attach mode (workspace root present): no assembly, installs + ensures member', async () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        writeWorkspaceJson(dir, ['app'])
        let assembled = false
        let installed = ''
        const r = await offerLinkPackage({
            slug: 'foo',
            workspaceDir: dir,
            mode: 'accept',
            assemble: () => {
                assembled = true
            },
            install: (cwd) => {
                installed = cwd
                return true
            },
        })
        expect(r).toBe(true)
        expect(assembled).toBe(false)
        expect(installed).toBe(dir)
        expect(JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8')).workspaces).toContain('foo')
    })

    it('bootstrap mode (no workspace root yet): assembles the workspace then installs', async () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        let assembled = ''
        let installed = ''
        const r = await offerLinkPackage({
            slug: 'foo',
            workspaceDir: dir,
            mode: 'accept',
            assemble: (d) => {
                assembled = d
            },
            install: (cwd) => {
                installed = cwd
                return true
            },
        })
        expect(r).toBe(true)
        expect(assembled).toBe(dir)
        expect(installed).toBe(dir)
    })

    it('skip mode returns false, no side effects', async () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        let touched = false
        const r = await offerLinkPackage({
            slug: 'foo',
            workspaceDir: dir,
            mode: 'skip',
            assemble: () => {
                touched = true
            },
            install: () => {
                touched = true
                return true
            },
        })
        expect(r).toBe(false)
        expect(touched).toBe(false)
    })

    it('returns true (intent expressed) but skips install when assembly fails', async () => {
        dir = mkdtempSync(join(tmpdir(), 'lp-'))
        let installed = false
        const r = await offerLinkPackage({
            slug: 'foo',
            workspaceDir: dir,
            mode: 'accept',
            assemble: () => {
                throw new Error('clone blew up')
            },
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
            assemble: () => {},
            install: () => false,
        })
        expect(r).toBe(true)
    })
})
