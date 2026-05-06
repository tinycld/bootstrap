import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { detectLayout, looksLikeAppShell } from '../src/layout.ts'

let cwd: string

beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'tcpkg-layout-'))
})

afterEach(() => {
    rmSync(cwd, { recursive: true, force: true })
})

function writeAppShell(dir: string, name = 'tinycld'): void {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }))
}

describe('detectLayout', () => {
    it('attaches to an existing tinycld child when cwd has one', () => {
        writeAppShell(join(cwd, 'tinycld'))

        const layout = detectLayout('todo', cwd)

        expect(layout.mode).toBe('attach')
        expect(layout.targetDir).toBe(join(cwd, 'todo'))
        expect(layout.appDir).toBe(join(cwd, 'tinycld'))
    })

    it('bootstraps a wrapper when cwd has no tinycld child', () => {
        const layout = detectLayout('todo', cwd)

        expect(layout.mode).toBe('bootstrap')
        expect(layout.targetDir).toBe(join(cwd, 'tinycld-todo', 'todo'))
        expect(layout.appDir).toBe(join(cwd, 'tinycld-todo', 'tinycld'))
        if (layout.mode === 'bootstrap') {
            expect(layout.wrapperDir).toBe(join(cwd, 'tinycld-todo'))
        }
    })

    it('bootstraps when cwd has a tinycld dir without a package.json', () => {
        // Bare directory named tinycld doesn't count — could be a coincidence.
        mkdirSync(join(cwd, 'tinycld'), { recursive: true })

        const layout = detectLayout('todo', cwd)

        expect(layout.mode).toBe('bootstrap')
    })

    it('bootstraps when cwd has a tinycld dir whose package.json has a different name', () => {
        // Some other project happens to be named tinycld in cwd. Don't false-match.
        writeAppShell(join(cwd, 'tinycld'), 'unrelated-project')

        const layout = detectLayout('todo', cwd)

        expect(layout.mode).toBe('bootstrap')
    })

    it('uses the slug for the wrapper directory name', () => {
        const layout = detectLayout('my-feature', cwd)

        if (layout.mode !== 'bootstrap') throw new Error('expected bootstrap mode')
        expect(layout.wrapperDir).toBe(join(cwd, 'tinycld-my-feature'))
        expect(layout.targetDir).toBe(join(cwd, 'tinycld-my-feature', 'my-feature'))
    })
})

describe('looksLikeAppShell', () => {
    it('returns true for a directory whose package.json declares name=tinycld', () => {
        writeAppShell(join(cwd, 'shell'))
        expect(looksLikeAppShell(join(cwd, 'shell'))).toBe(true)
    })

    it('returns false when the directory does not exist', () => {
        expect(looksLikeAppShell(join(cwd, 'nonexistent'))).toBe(false)
    })

    it('returns false when package.json is missing', () => {
        mkdirSync(join(cwd, 'no-pkg'), { recursive: true })
        expect(looksLikeAppShell(join(cwd, 'no-pkg'))).toBe(false)
    })

    it('returns false for an unrelated package.json name', () => {
        writeAppShell(join(cwd, 'other'), '@scope/other')
        expect(looksLikeAppShell(join(cwd, 'other'))).toBe(false)
    })

    it('returns false for malformed JSON', () => {
        mkdirSync(join(cwd, 'broken'), { recursive: true })
        writeFileSync(join(cwd, 'broken', 'package.json'), 'not valid json')
        expect(looksLikeAppShell(join(cwd, 'broken'))).toBe(false)
    })
})
