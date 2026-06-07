import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const run = promisify(execFile)
const BOOTSTRAP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

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
//
// Every external command is async (promisified execFile), NOT execFileSync: a
// synchronous multi-minute call blocks the vitest worker's event loop, which
// stalls its reporter RPC heartbeat to the main process — surfacing as a
// spurious "Timeout calling onTaskUpdate" that fails the run even when all
// assertions pass. Async keeps the loop responsive.
const ENABLED = process.env.BOOTSTRAP_INTEGRATION === '1'
const TINYCLD_REF = process.env.BOOTSTRAP_INTEGRATION_REF
const REPO_BASE = process.env.TINYCLD_REPO_BASE || 'https://github.com/tinycld'

// Generous: a cold clone + full pnpm install of the Expo/PocketBase tree pulls
// >1200 packages and runs a Go schema export. 12 min keeps a slow runner from a
// false failure without masking a genuine hang.
const TIMEOUT_MS = 12 * 60 * 1000

describe.runIf(ENABLED)('bootstrap assembles a working tinycld install (integration)', () => {
    let root: string

    beforeAll(async () => {
        root = mkdtempSync(join(tmpdir(), 'bs-int-'))
        // Drive the real CLI (tsx src/index.ts) rather than calling
        // runAssembleOnly in-process: its clone is a synchronous spawnSync, and
        // running it out-of-process via async execFile keeps the worker loop free
        // during the clone too. The CLI assembles into its cwd, so run it FROM the
        // temp root (referencing index.ts by absolute path) — never from the
        // bootstrap repo, which the CLI would otherwise assemble into.
        // --with tinycld@<ref> pins the merged repo.
        const cli = join(BOOTSTRAP_ROOT, 'src', 'index.ts')
        const tsx = join(BOOTSTRAP_ROOT, 'node_modules', '.bin', 'tsx')
        const withTinycld = TINYCLD_REF ? ['--with', `tinycld@${TINYCLD_REF}`] : []
        await run(tsx, [cli, '--assemble-only', ...withTinycld], {
            cwd: root,
            env: { ...process.env, TINYCLD_REPO_BASE: REPO_BASE },
            timeout: TIMEOUT_MS,
        }).catch((err) => {
            throw new Error(`assemble failed: ${err.stderr || err.message}`)
        })
        // Real install: runs the postinstall (link-members → generate →
        // link-members → assets), which is where pbSchema export + go.work
        // emission happen — the steps the assertions below verify.
        await run('pnpm', ['install', '--no-frozen-lockfile'], {
            cwd: root,
            env: { ...process.env, TINYCLD_REPO_BASE: REPO_BASE },
            timeout: TIMEOUT_MS,
        }).catch((err) => {
            throw new Error(`install failed:\n${err.stdout}\n${err.stderr}`)
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
        expect(existsSync(join(root, 'tinycld', 'server', 'go.work'))).toBe(true)
    })

    it(
        'typechecks the assembled app shell + core (tinycld-pkg typecheck)',
        async () => {
            // Rejects on non-zero exit → the test fails with tsc's output attached.
            await run('pnpm', ['exec', 'tinycld-pkg', 'typecheck'], {
                cwd: join(root, 'tinycld'),
                timeout: TIMEOUT_MS,
            }).catch((err) => {
                throw new Error(`typecheck failed:\n${err.stdout}\n${err.stderr}`)
            })
        },
        TIMEOUT_MS
    )

    it(
        'builds the Go server (go build -o tinycld .)',
        async () => {
            await run('go', ['build', '-o', 'tinycld', '.'], {
                cwd: join(root, 'tinycld', 'server'),
                timeout: TIMEOUT_MS,
            }).catch((err) => {
                throw new Error(`go build failed:\n${err.stdout}\n${err.stderr}`)
            })
        },
        TIMEOUT_MS
    )
})
