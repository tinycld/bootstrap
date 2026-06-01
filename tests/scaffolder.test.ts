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
            'vitest.config.ts',
            'playwright.config.ts',
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

    it('package.json scripts run through tinycld-pkg', () => {
        const target = scaffold()
        const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
        expect(pkg.scripts.typecheck).toBe('tinycld-pkg typecheck')
        expect(pkg.scripts.test).toBe('tinycld-pkg test')
        expect(pkg.scripts['test:e2e']).toBe('tinycld-pkg test:e2e')
        expect(pkg.scripts.check).toBe('tinycld-pkg check')
        // The old standalone tsc invocation is gone.
        expect(pkg.scripts.typecheck).not.toContain('tsc')
        expect(pkg.devDependencies['@tinycld/package-scripts']).toBe('*')
    })

    it('vitest/playwright configs spread the app shell config', () => {
        const target = scaffold()
        const vitest = readFileSync(join(target, 'vitest.config.ts'), 'utf8')
        expect(vitest).toContain("from '../app/vitest.config'")
        const playwright = readFileSync(join(target, 'playwright.config.ts'), 'utf8')
        expect(playwright).toContain("from '../app/playwright.config'")
        // The symlink path is tokenized to this package's slug.
        expect(playwright).toContain("'@tinycld', 'my-feature'")
        expect(playwright).not.toMatch(/\{\{PKG_[A-Z_]+\}\}/)
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

    it('generates a ci.yml for the standalone-core workspace layout', () => {
        const target = scaffold()
        const yml = readFileSync(join(target, '.github/workflows/ci.yml'), 'utf8')
        // PACKAGE env carries the slug; the member slot is ws/<slug>.
        expect(yml).toContain('PACKAGE: my-feature')
        // The PR's code is checked out into ws/<slug>; the rest of the workspace
        // (app + core + root coordination files) comes from bootstrap.
        expect(yml).toContain('npx @tinycld/bootstrap@latest --assemble-only')
        // Node is pinned BEFORE the assemble step (bootstrap needs >=24); the
        // workspace-pinned version takes over after.
        expect(yml).toContain("node-version: '24'")
        expect(yml).toContain('node-version-file: ws/.node-version')
        // The old workspace meta-repo clone is gone — bootstrap is the source
        // of the root coordination files now.
        expect(yml).not.toContain('repository: tinycld/workspace')
        expect(yml).not.toContain('--tooling')
        // Checks/e2e run scoped to this member via tinycld-pkg.
        expect(yml).toContain('npx tinycld-pkg check')
        expect(yml).toContain('npx tinycld-pkg test:e2e')
        // Old-layout wiring is gone — no app-shell clone, no packages:link, no CORE_REPO.
        expect(yml).not.toContain('packages:link')
        expect(yml).not.toContain('CORE_REPO')
        expect(yml).not.toContain('APP_REPO')
        // Substituted; no PKG_* placeholders left over (CI uses ${{ env.X }}
        // which is GH Actions, not our tokens).
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

    it('server go.mod requires core but does NOT replace it', () => {
        const target = scaffold()
        const goMod = readFileSync(join(target, 'server/go.mod'), 'utf8')
        expect(goMod).toContain('module tinycld.org/packages/my-feature')
        expect(goMod).toContain('tinycld.org/core v0.0.0')
        // The replace must NOT live in go.mod. When the assembled app build
        // `use`s this member's server via app/server/go.work, a go.mod replace
        // (→ ../../core/server) collides with the npm-symlinked core path
        // (node_modules/@tinycld/core/server), producing
        // "conflicting replacements for tinycld.org/core" and a failed `go build`.
        // Core is resolved instead through the generator-emitted, gitignored
        // server/go.work (buildMemberGoWork) for standalone member builds only.
        expect(goMod).not.toContain('replace tinycld.org/core')
        // The old bundled-core path is gone.
        expect(goMod).not.toContain('packages/@tinycld/core')
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
        // Extends the app shell's package tsconfig base (noEmit etc. inherited).
        expect(ts.extends).toBe('../app/tsconfig.package-base.json')
        // Core is a standalone sibling member at ../core/.
        expect(ts.compilerOptions.paths['@tinycld/core/*']).toEqual(['../core/*'])
        expect(ts.compilerOptions.paths['@tinycld/app-generated/*']).toEqual(['../app/lib/generated/*'])
        // Cross-sibling imports aren't supported — no @tinycld/* alias.
        expect(ts.compilerOptions.paths['@tinycld/*']).toBeUndefined()
        expect(ts.compilerOptions.paths['~/tinycld/my-feature/*']).toEqual(['./tinycld/my-feature/*'])
        // Old-layout artifacts are gone.
        expect(ts.compilerOptions.paths['~/*']).toBeUndefined()
        expect(ts.compilerOptions.rootDir).toBeUndefined()
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
            // The vitest config ships from shared/ for every preset.
            'vitest.config.ts',
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
            // settings-only has no e2e specs — the playwright config ships
            // only with the full preset.
            'playwright.config.ts',
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

    it('package.json has tinycld-pkg scripts but no e2e', () => {
        const target = scaffold(base)
        const pkg = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'))
        expect(pkg.scripts.typecheck).toBe('tinycld-pkg typecheck')
        expect(pkg.scripts.test).toBe('tinycld-pkg test')
        expect(pkg.scripts.check).toBe('tinycld-pkg check')
        // No playwright config ships with settings-only, so no e2e script.
        expect(pkg.scripts['test:e2e']).toBeUndefined()
        expect(pkg.devDependencies['@tinycld/package-scripts']).toBe('*')
    })
})
