import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
    validateDescription,
    validateIcon,
    validateName,
    validateNavOrder,
    validateShortcut,
    validateSlug,
    validateTargetDir,
} from '../src/validate.ts'

describe('validateSlug', () => {
    it('accepts valid kebab-case slugs', () => {
        expect(validateSlug('my-feature')).toBeNull()
        expect(validateSlug('feature1')).toBeNull()
        expect(validateSlug('abc')).toBeNull()
    })

    it('rejects too-short or too-long slugs', () => {
        expect(validateSlug('')).toContain('at least 3')
        expect(validateSlug('ab')).toContain('at least 3')
        expect(validateSlug('a'.repeat(41))).toContain('40 characters')
    })

    it('rejects invalid character patterns', () => {
        expect(validateSlug('MyFeature')).toContain('kebab-case')
        expect(validateSlug('-leading')).toContain('kebab-case')
        expect(validateSlug('trailing-')).toContain('kebab-case')
        expect(validateSlug('has space')).toContain('kebab-case')
        expect(validateSlug('under_score')).toContain('kebab-case')
    })

    it('rejects reserved names', () => {
        expect(validateSlug('core')).toContain('reserved')
        expect(validateSlug('test')).toContain('reserved')
    })
})

describe('validateName + validateDescription', () => {
    it('rejects empty strings', () => {
        expect(validateName('')).toBeTruthy()
        expect(validateDescription('')).toBeTruthy()
    })

    it('accepts reasonable values', () => {
        expect(validateName('My Feature')).toBeNull()
        expect(validateDescription('Does a thing.')).toBeNull()
    })

    it('accepts safe punctuation that lands in generated code intact', () => {
        expect(validateName('Mail & Calendar')).toBeNull()
        expect(validateDescription('Sync contacts, tasks, and notes (v2)!')).toBeNull()
    })

    it('rejects single quotes that would break single-quoted TS strings', () => {
        expect(validateName("It's Great")).toContain("' character")
        expect(validateDescription("It's great")).toContain("' character")
    })

    it('rejects double quotes that would break JSON', () => {
        expect(validateName('Say "hi"')).toContain('" character')
        expect(validateDescription('Say "hi"')).toContain('" character')
    })

    it('rejects backslashes', () => {
        expect(validateName('back\\slash')).toContain('\\ character')
        expect(validateDescription('back\\slash')).toContain('\\ character')
    })

    it('rejects backticks', () => {
        expect(validateName('use `code`')).toContain('` character')
        expect(validateDescription('use `code`')).toContain('` character')
    })

    it('rejects template-literal injection', () => {
        // Build the "${" digraph via concatenation so the literal doesn't sit in
        // source (it would trip biome's noTemplateCurlyInString) — the value under
        // test still contains it at runtime, which is what must be rejected.
        const dollarBrace = `$${'{'}`
        expect(validateName(`hi ${dollarBrace}process.env}`)).toContain(dollarBrace)
        expect(validateDescription(`hi ${dollarBrace}1}`)).toContain(dollarBrace)
    })

    it('rejects newlines and control characters', () => {
        expect(validateName('line1\nline2')).toContain('control characters')
        expect(validateDescription('tab\there')).toContain('control characters')
    })
})

describe('validateIcon / validateNavOrder / validateShortcut', () => {
    it('treats icon as optional', () => {
        expect(validateIcon('')).toBeNull()
        expect(validateIcon('box')).toBeNull()
        expect(validateIcon('box-icon')).toBeNull()
        expect(validateIcon('BoxIcon')).toBeTruthy()
    })

    it('enforces nav order range', () => {
        expect(validateNavOrder('20')).toBeNull()
        expect(validateNavOrder('0')).toBeNull()
        expect(validateNavOrder('99')).toBeNull()
        expect(validateNavOrder('100')).toBeTruthy()
        expect(validateNavOrder('-1')).toBeTruthy()
        expect(validateNavOrder('abc')).toBeTruthy()
        expect(validateNavOrder('1.5')).toBeTruthy()
    })

    it('requires single-letter shortcut when present', () => {
        expect(validateShortcut('')).toBeNull()
        expect(validateShortcut('a')).toBeNull()
        expect(validateShortcut('ab')).toBeTruthy()
        expect(validateShortcut('A')).toBeTruthy()
        expect(validateShortcut('1')).toBeTruthy()
    })
})

describe('validateTargetDir', () => {
    let tmpRoot: string
    beforeEach(() => {
        tmpRoot = mkdtempSync(join(tmpdir(), 'tcpkg-'))
    })
    afterEach(() => {
        rmSync(tmpRoot, { recursive: true, force: true })
    })

    it('accepts non-existent path', () => {
        expect(validateTargetDir(join(tmpRoot, 'does-not-exist'))).toBeNull()
    })

    it('accepts empty existing dir', () => {
        const dir = join(tmpRoot, 'empty')
        mkdirSync(dir)
        expect(validateTargetDir(dir)).toBeNull()
    })

    it('rejects existing non-empty dir', () => {
        const dir = join(tmpRoot, 'non-empty')
        mkdirSync(dir)
        writeFileSync(join(dir, 'file.txt'), 'x')
        expect(validateTargetDir(dir)).toContain('not empty')
    })

    it('rejects existing file', () => {
        const file = join(tmpRoot, 'not-a-dir')
        writeFileSync(file, 'x')
        expect(validateTargetDir(file)).toContain('not a directory')
    })
})
