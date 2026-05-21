import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { runToolingMode } from '../src/index.ts'

let dir: string
afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('runToolingMode', () => {
    it('writes the workspace manifest and clones via the injected runner', () => {
        dir = mkdtempSync(join(tmpdir(), 'tool-'))
        const cloned: string[] = []
        runToolingMode({
            root: dir,
            members: ['contacts'],
            clone: (_url, dest) => {
                cloned.push(dest.split('/').pop() ?? '')
                return true
            },
        })
        expect(existsSync(join(dir, 'package.json'))).toBe(true)
        expect(cloned).toEqual(['app', 'core', 'contacts'])
        const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf-8'))
        expect(pkg.workspaces).toContain('package-scripts')
    })

    it('throws if a required member (app/core) fails to clone', () => {
        dir = mkdtempSync(join(tmpdir(), 'tool-'))
        // clone succeeds only for core → app is missing → guard must throw
        expect(() => runToolingMode({ root: dir, clone: (_url, dest) => dest.endsWith('/core') })).toThrow(
            /required member 'app'/
        )
    })
})
