import { describe, expect, it } from 'vitest'
import { parseArgs } from '../src/args.ts'

describe('parseArgs --tooling', () => {
    it('parses --tooling as a boolean flag', () => {
        expect(parseArgs(['--tooling']).tooling).toBe(true)
    })
    it('defaults tooling to undefined when absent', () => {
        expect(parseArgs([]).tooling).toBeUndefined()
    })
    it('rejects a value for --tooling', () => {
        expect(() => parseArgs(['--tooling=x'])).toThrow()
    })
})

describe('parseArgs --with (repeatable, collects features)', () => {
    it('collects a single --with value into an array', () => {
        expect(parseArgs(['--tooling', '--with', 'mail']).with).toEqual(['mail'])
    })
    it('collects multiple --with values', () => {
        expect(parseArgs(['--tooling', '--with', 'mail', '--with', 'contacts']).with).toEqual(['mail', 'contacts'])
    })
    it('supports --with=slug inline form', () => {
        expect(parseArgs(['--with=drive']).with).toEqual(['drive'])
    })
    it('defaults with to undefined when absent', () => {
        expect(parseArgs(['--tooling']).with).toBeUndefined()
    })
})
