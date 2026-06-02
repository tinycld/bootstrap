import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ParsedArgs } from '../src/args.ts'
import { composeAssembleOutro, resolveMode } from '../src/index.ts'

let err: ReturnType<typeof vi.spyOn>

beforeEach(() => {
    err = vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
    err.mockRestore()
})

describe('resolveMode', () => {
    it('returns "new" when --new is set', () => {
        const args: ParsedArgs = { new: true, slug: 'my-feature' }
        expect(resolveMode(args)).toBe('new')
    })

    it('returns "assemble-only" when --assemble-only is set', () => {
        const args: ParsedArgs = { assembleOnly: true, with: ['mail'] }
        expect(resolveMode(args)).toBe('assemble-only')
    })

    it('returns "usage" when no mode flag is set', () => {
        // Bare positional slug is no longer valid on its own — it must be
        // paired with --new. Resolves to "usage" so main() prints the help.
        const args: ParsedArgs = { slug: 'my-feature' }
        expect(resolveMode(args)).toBe('usage')
    })

    it('returns "usage" when no flags at all', () => {
        const args: ParsedArgs = {}
        expect(resolveMode(args)).toBe('usage')
    })

    it('rejects --assemble-only combined with --new', () => {
        const args: ParsedArgs = { assembleOnly: true, new: true, slug: 'x' }
        expect(resolveMode(args)).toBe('usage')
        expect(err).toHaveBeenCalledTimes(1)
        expect(String(err.mock.calls[0]?.[0])).toMatch(/mutually exclusive/)
    })
})

describe('composeAssembleOutro', () => {
    it('lists no extras when --with was not used', () => {
        expect(composeAssembleOutro(undefined)).toBe(
            'Workspace assembled (app + core). Run `pnpm install` at the root.'
        )
    })
    it('lists no extras when --with was empty', () => {
        expect(composeAssembleOutro([])).toBe('Workspace assembled (app + core). Run `pnpm install` at the root.')
    })
    it('appends a single --with member', () => {
        expect(composeAssembleOutro(['mail'])).toBe(
            'Workspace assembled (app + core, mail). Run `pnpm install` at the root.'
        )
    })
    it('appends multiple --with members separated by commas', () => {
        expect(composeAssembleOutro(['mail', 'contacts'])).toBe(
            'Workspace assembled (app + core, mail, contacts). Run `pnpm install` at the root.'
        )
    })
})
