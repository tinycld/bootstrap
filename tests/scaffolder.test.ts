import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyTemplate, resolveTemplatesRoot } from '../src/copy-template.ts'
import type { Answers } from '../src/substitute.ts'

const templatesRoot = resolveTemplatesRoot(import.meta.url).replace('/tests/..', '')

let tmpRoot: string
beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'tcpkg-scaffolder-'))
})
afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
})

function scaffold(overrides: Partial<Answers> = {}): string {
    const target = join(tmpRoot, 'generated')
    const answers: Answers = {
        slug: 'my-feature',
        name: 'My Feature',
        description: 'Does a thing.',
        preset: 'full',
        icon: 'box',
        navOrder: 20,
        navShortcut: 'f',
        includeServer: true,
        targetDir: target,
        ...overrides,
    }
    copyTemplate(templatesRoot, answers)
    return target
}

describe('copyTemplate — full preset', () => {
    it('writes all expected files', () => {
        const target = scaffold()
        const expected = [
            'package.json',
            'manifest.ts',
            'tsconfig.json',
            '.gitignore',
            'README.md',
            'tinycld/my-feature/types.ts',
            'tinycld/my-feature/collections.ts',
            'tinycld/my-feature/sidebar.tsx',
            'tinycld/my-feature/provider.tsx',
            'tinycld/my-feature/seed.ts',
            'tinycld/my-feature/screens/_layout.tsx',
            'tinycld/my-feature/screens/index.tsx',
            'tinycld/my-feature/screens/[id].tsx',
            'pb-migrations/1800000000_create_my-feature.js',
            'server/go.mod',
            'server/register.go',
            'tests/manifest.test.ts',
            '.github/workflows/ci.yml',
        ]
        for (const path of expected) {
            expect(existsSync(join(target, path)), `missing ${path}`).toBe(true)
        }
    })

    it('substitutes placeholders in package.json', () => {
        const target = scaffold()
        const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
        expect(pkg.name).toBe('@tinycld/my-feature')
        expect(pkg.description).toBe('Does a thing.')
    })

    it('substitutes placeholders in manifest.ts', () => {
        const target = scaffold()
        const src = readFileSync(join(target, 'manifest.ts'), 'utf8')
        expect(src).toContain("name: 'My Feature'")
        expect(src).toContain("slug: 'my-feature'")
        expect(src).toContain("icon: 'box'")
        expect(src).toContain('order: 20')
        expect(src).toContain("shortcut: 'f'")
        expect(src).toContain("module: 'tinycld.org/packages/my-feature'")
        // No leftover placeholder tokens.
        expect(src).not.toMatch(/\{\{[A-Z_]+\}\}/)
    })

    it('substitutes the migration filename', () => {
        const target = scaffold()
        expect(existsSync(join(target, 'pb-migrations', '1800000000_create_my-feature.js'))).toBe(true)
    })

    it('generates a ci.yml that references the slug and the new app shell', () => {
        const target = scaffold()
        const yml = readFileSync(join(target, '.github/workflows/ci.yml'), 'utf8')
        expect(yml).toContain('path: my-feature')
        expect(yml).toContain('APP_REPO: tinycld/tinycld')
        // CORE_REPO is gone — core ships inside the app shell now.
        expect(yml).not.toContain('CORE_REPO')
        expect(yml).toContain('packages:link ../my-feature')
        // Substituted; no PKG_* placeholders left over (CI uses ${{ env.X }}
        // and ${{ hashFiles(...) }} which are GH Actions, not our tokens).
        expect(yml).not.toMatch(/\{\{PKG_[A-Z_]+\}\}/)
    })

    it('omits server/ when includeServer is false', () => {
        const target = scaffold({ includeServer: false })
        expect(existsSync(join(target, 'server'))).toBe(false)
        const manifest = readFileSync(join(target, 'manifest.ts'), 'utf8')
        expect(manifest).not.toContain('server:')
    })

    it('derives casing variants correctly in component identifiers', () => {
        const target = scaffold()
        const sidebar = readFileSync(join(target, 'tinycld/my-feature/sidebar.tsx'), 'utf8')
        expect(sidebar).toContain('MyFeatureSidebar')
        const provider = readFileSync(join(target, 'tinycld/my-feature/provider.tsx'), 'utf8')
        expect(provider).toContain('MyFeatureProvider')
    })

    it('manifest references the short export-map subpaths', () => {
        const target = scaffold()
        const m = readFileSync(join(target, 'manifest.ts'), 'utf8')
        // Short subpaths match the package.json exports map keys; the
        // generator maps these to the physical tinycld/<slug>/* layout via
        // resolveExportPath().
        expect(m).toContain("directory: 'screens'")
        expect(m).toContain("component: 'sidebar'")
        expect(m).toContain("component: 'provider'")
        expect(m).toContain("register: 'collections'")
        expect(m).toContain("types: 'types'")
        expect(m).toContain("script: 'seed'")
    })

    it('package.json exports point at nested paths', () => {
        const target = scaffold()
        const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
        expect(pkg.exports['./types']).toBe('./tinycld/my-feature/types.ts')
        expect(pkg.exports['./seed']).toBe('./tinycld/my-feature/seed.ts')
        expect(pkg.exports['./screens/*']).toBe('./tinycld/my-feature/screens/*.tsx')
    })

    it('tsconfig.json declares the new path aliases', () => {
        const target = scaffold()
        const ts = JSON.parse(readFileSync(join(target, 'tsconfig.json'), 'utf8'))
        expect(ts.extends).toBe('../tinycld/tsconfig.json')
        // Core's source is bundled at tinycld/packages/@tinycld/core/{lib,components,...}/.
        expect(ts.compilerOptions.paths['@tinycld/core/*']).toEqual(['../tinycld/packages/@tinycld/core/*'])
        expect(ts.compilerOptions.paths['@tinycld/app-generated/*']).toEqual(['../tinycld/lib/generated/*'])
        // Cross-sibling imports aren't supported — no @tinycld/* alias.
        expect(ts.compilerOptions.paths['@tinycld/*']).toBeUndefined()
        expect(ts.compilerOptions.paths['~/tinycld/my-feature/*']).toEqual(['./tinycld/my-feature/*'])
    })

    it('sibling source files import from @tinycld/core, not ~/', () => {
        const target = scaffold()
        const sidebar = readFileSync(join(target, 'tinycld/my-feature/sidebar.tsx'), 'utf8')
        expect(sidebar).toContain("from '@tinycld/core/lib/use-app-theme'")
        expect(sidebar).not.toMatch(/from ['"]~\//)
        const collections = readFileSync(join(target, 'tinycld/my-feature/collections.ts'), 'utf8')
        expect(collections).toContain("from '@tinycld/core/lib/pocketbase'")
        expect(collections).toContain("from '@tinycld/core/types/pbSchema'")
    })
})

describe('copyTemplate — settings-only preset', () => {
    const base: Partial<Answers> = {
        preset: 'settings-only',
        icon: undefined,
        navOrder: undefined,
        navShortcut: undefined,
        includeServer: undefined,
    }

    it('writes a minimal file tree (no screens, no server, no pb-migrations)', () => {
        const target = scaffold(base)
        const shouldExist = [
            'package.json',
            'manifest.ts',
            'tsconfig.json',
            '.gitignore',
            'README.md',
            'tinycld/my-feature/types.ts',
            'tinycld/my-feature/settings/main.tsx',
            'tests/manifest.test.ts',
            '.github/workflows/ci.yml',
        ]
        for (const p of shouldExist) {
            expect(existsSync(join(target, p)), `missing ${p}`).toBe(true)
        }
        const shouldNotExist = [
            'screens',
            'pb-migrations',
            'server',
            'sidebar.tsx',
            'provider.tsx',
            'collections.ts',
            'tinycld/my-feature/screens',
            'tinycld/my-feature/sidebar.tsx',
            'tinycld/my-feature/provider.tsx',
            'tinycld/my-feature/collections.ts',
            // Biome lives only in the app shell — siblings never ship
            // their own biome.json (see tinycld/CLAUDE.md).
            'biome.json',
        ]
        for (const p of shouldNotExist) {
            expect(existsSync(join(target, p)), `unexpected ${p}`).toBe(false)
        }
    })

    it('omits routes and server fields from the manifest', () => {
        const target = scaffold(base)
        const manifest = readFileSync(join(target, 'manifest.ts'), 'utf8')
        expect(manifest).not.toContain('routes:')
        expect(manifest).not.toContain('server:')
        expect(manifest).toContain('settings: [')
        expect(manifest).toContain("component: 'settings/main'")
    })
})
