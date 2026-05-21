import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { bootstrapTooling, writeWorkspaceManifest } from '../src/bootstrap-tooling.ts'

let dir: string
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
})

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
})

describe('bootstrapTooling (clone scope)', () => {
    it('clones ONLY app + core by default (no features)', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const cloned: string[] = []
        bootstrapTooling({
            root: dir,
            clone: (_u, d) => {
                cloned.push(d.split('/').pop() ?? '')
                return true
            },
        })
        expect(cloned).toEqual(['app', 'core'])
    })

    it('clones app + core + only the requested features', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        const cloned: string[] = []
        bootstrapTooling({
            root: dir,
            members: ['mail'],
            clone: (_u, d) => {
                cloned.push(d.split('/').pop() ?? '')
                return true
            },
        })
        expect(cloned).toEqual(['app', 'core', 'mail'])
    })

    it('throws on an unknown feature member', () => {
        dir = mkdtempSync(join(tmpdir(), 'ws-'))
        expect(() => bootstrapTooling({ root: dir, members: ['nope'], clone: () => true })).toThrow(/Unknown feature/)
    })
})
