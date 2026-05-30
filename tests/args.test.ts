import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/args.ts'

describe('parseArgs --new', () => {
    it('parses --new as a boolean flag', () => {
        expect(parseArgs(['--new']).new).toBe(true)
    })
    it('defaults new to undefined when absent', () => {
        expect(parseArgs([]).new).toBeUndefined()
    })
    it('rejects a value for --new', () => {
        expect(() => parseArgs(['--new=x'])).toThrow()
    })
    it('collects a positional slug alongside --new', () => {
        const args = parseArgs(['--new', 'my-feature'])
        expect(args.new).toBe(true)
        expect(args.slug).toBe('my-feature')
    })
})

describe('parseArgs --assemble-only', () => {
    it('parses --assemble-only as a boolean flag', () => {
        expect(parseArgs(['--assemble-only']).assembleOnly).toBe(true)
    })
    it('defaults assembleOnly to undefined when absent', () => {
        expect(parseArgs([]).assembleOnly).toBeUndefined()
    })
    it('rejects a value for --assemble-only', () => {
        expect(() => parseArgs(['--assemble-only=x'])).toThrow()
    })
})

describe('parseArgs --tooling (removed in v2)', () => {
    it('rejects --tooling with a targeted error pointing at --assemble-only', () => {
        expect(() => parseArgs(['--tooling'])).toThrow(/--tooling.*removed in v2.*--assemble-only/)
    })
    it('rejects --no-tooling with the same targeted error', () => {
        // No-tooling is just as removed as tooling itself.
        expect(() => parseArgs(['--no-tooling'])).toThrow(/--tooling.*removed in v2/)
    })
})

describe('parseArgs --with (repeatable, collects features)', () => {
    it('collects a single --with value into an array', () => {
        expect(parseArgs(['--assemble-only', '--with', 'mail']).with).toEqual(['mail'])
    })
    it('collects multiple --with values', () => {
        expect(parseArgs(['--assemble-only', '--with', 'mail', '--with', 'contacts']).with).toEqual([
            'mail',
            'contacts',
        ])
    })
    it('supports --with=slug inline form', () => {
        expect(parseArgs(['--with=drive']).with).toEqual(['drive'])
    })
    it('defaults with to undefined when absent', () => {
        expect(parseArgs(['--assemble-only']).with).toBeUndefined()
    })
    it('throws when --with has no value', () => {
        expect(() => parseArgs(['--with'])).toThrow(/feature slug/)
    })
})
