import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { detectLayout, looksLikeWorkspaceRoot } from '../src/layout.ts'

let dir: string
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('detectLayout', () => {
    it('attaches when cwd IS a workspace root (package.json name @tinycld/workspace)', () => {
        dir = mkdtempSync(join(tmpdir(), 'lay-'))
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@tinycld/workspace', workspaces: ['app'] }))
        const layout = detectLayout('newpkg', dir)
        expect(layout.mode).toBe('attach')
        expect(layout.targetDir).toBe(join(dir, 'newpkg'))
        expect(layout.workspaceDir).toBe(dir)
    })

    it('bootstraps when cwd is NOT a workspace root', () => {
        dir = mkdtempSync(join(tmpdir(), 'lay-'))
        const layout = detectLayout('newpkg', dir)
        expect(layout.mode).toBe('bootstrap')
        expect(layout.targetDir).toBe(join(dir, 'tinycld-newpkg', 'newpkg'))
        expect(layout.workspaceDir).toBe(join(dir, 'tinycld-newpkg'))
    })
})

describe('looksLikeWorkspaceRoot', () => {
    it('true when package.json name is @tinycld/workspace', () => {
        dir = mkdtempSync(join(tmpdir(), 'lay-'))
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@tinycld/workspace' }))
        expect(looksLikeWorkspaceRoot(dir)).toBe(true)
    })
    it('false when no package.json', () => {
        dir = mkdtempSync(join(tmpdir(), 'lay-'))
        expect(looksLikeWorkspaceRoot(dir)).toBe(false)
    })
    it('false when package.json name is something else', () => {
        dir = mkdtempSync(join(tmpdir(), 'lay-'))
        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'other' }))
        expect(looksLikeWorkspaceRoot(dir)).toBe(false)
    })
    it('false on a non-existent directory', () => {
        expect(looksLikeWorkspaceRoot(join(tmpdir(), `definitely-does-not-exist-${Date.now()}`))).toBe(false)
    })
    it('false when package.json is malformed JSON', () => {
        dir = mkdtempSync(join(tmpdir(), 'lay-'))
        writeFileSync(join(dir, 'package.json'), 'not valid json {')
        expect(looksLikeWorkspaceRoot(dir)).toBe(false)
    })
})
