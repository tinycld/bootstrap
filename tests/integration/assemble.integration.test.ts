import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { runAssembleOnly } from '../../src/index.ts'

// Real end-to-end assembly: clones the tinycld member from GitHub, runs a real
// `pnpm install` (generator + link-members + Go wiring + schema export), and
// asserts the assembled workspace is actually BUILDABLE — not just that the
// right files were written. The stubbed-clone unit tests verify the bootstrap's
// internal model; this verifies that model produces a working install against
// the real repo. It is the lane that catches layout drift between bootstrap and
// the tinycld repo (e.g. a repo merge bootstrap hasn't been taught about).
//
// Gated behind BOOTSTRAP_INTEGRATION=1: it clones (network) and installs
// (minutes), so it never runs in the default offline `vitest run`. CI runs it in
// a dedicated job. Pin the tinycld ref via BOOTSTRAP_INTEGRATION_REF (default:
// main) to validate a pre-merge branch.
const ENABLED = process.env.BOOTSTRAP_INTEGRATION === '1'
const TINYCLD_REF = process.env.BOOTSTRAP_INTEGRATION_REF || undefined
const REPO_BASE = process.env.TINYCLD_REPO_BASE || 'https://github.com/tinycld'

// Generous: a cold clone + full pnpm install of the Expo/PocketBase tree pulls
// >1200 packages and runs a Go schema export. 12 min keeps a slow runner from a
// false failure without masking a genuine hang.
const TIMEOUT_MS = 12 * 60 * 1000

describe.runIf(ENABLED)('bootstrap assembles a working tinycld install (integration)', () => {
    let root: string

    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'bs-int-'))
        // Explicit root (never process.cwd()) so the assemble can't write into
        // the bootstrap repo itself.
        runAssembleOnly({ root, tinycldRef: TINYCLD_REF, members: [] })
        execFileSync('pnpm', ['install', '--no-frozen-lockfile'], {
            cwd: root,
            stdio: 'inherit',
            env: { ...process.env, TINYCLD_REPO_BASE: REPO_BASE },
            timeout: TIMEOUT_MS,
        })
    }, TIMEOUT_MS)

    afterAll(() => {
        if (root) rmSync(root, { recursive: true, force: true })
    })

    it('clones the merged repo into the tinycld/ slot with core + package-scripts nested', () => {
        expect(statSync(join(root, 'tinycld')).isDirectory()).toBe(true)
        expect(statSync(join(root, 'tinycld', 'core')).isDirectory()).toBe(true)
        expect(statSync(join(root, 'tinycld', 'package-scripts')).isDirectory()).toBe(true)
    })

    it('exports pbSchema into the in-repo nested core (where typecheck resolves @tinycld/core/types/pbSchema)', () => {
        // The original regression wrote this into a separately-cloned ws/core,
        // leaving the in-repo core's copy missing → TS2307 across core. Assert it
        // lands in the nested core the typecheck actually reads.
        expect(existsSync(join(root, 'tinycld', 'core', 'types', 'pbSchema.ts'))).toBe(true)
        expect(existsSync(join(root, 'tinycld', 'core', 'types', 'pbZodSchema.ts'))).toBe(true)
    })

    it('emits server/go.work so the Go build resolves core transitive deps in workspace mode', () => {
        // With zero feature servers, an absent go.work drops the app build to
        // single-module mode and fails on "missing go.sum entry for go.mod file"
        // for deps reached through the core replace. The go.work must always list
        // core.
        const goWork = join(root, 'tinycld', 'server', 'go.work')
        expect(existsSync(goWork)).toBe(true)
    })

    it(
        'typechecks the assembled app shell + core (tinycld-pkg typecheck)',
        () => {
            // Throws on non-zero exit → the test fails with tsc's output attached.
            execFileSync('pnpm', ['exec', 'tinycld-pkg', 'typecheck'], {
                cwd: join(root, 'tinycld'),
                stdio: 'inherit',
                timeout: TIMEOUT_MS,
            })
        },
        TIMEOUT_MS
    )

    it(
        'builds the Go server (go build -o tinycld .)',
        () => {
            execFileSync('go', ['build', '-o', 'tinycld', '.'], {
                cwd: join(root, 'tinycld', 'server'),
                stdio: 'inherit',
                timeout: TIMEOUT_MS,
            })
        },
        TIMEOUT_MS
    )
})
