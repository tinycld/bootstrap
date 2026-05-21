/**
 * Minimal argv parser for bootstrap. Every prompt has a
 * corresponding --flag; when a flag is set, the associated prompt is
 * skipped. --yes accepts all defaults.
 */

export type Preset = 'full' | 'settings-only'

export interface ParsedArgs {
    slug?: string
    name?: string
    description?: string
    preset?: Preset
    icon?: string
    navOrder?: number
    shortcut?: string
    server?: boolean
    target?: string
    link?: boolean
    yes?: boolean
    tooling?: boolean
    with?: string[]
}

interface FlagError {
    flag: string
    reason: string
}

export class ArgParseError extends Error {
    constructor(public issues: FlagError[]) {
        super(issues.map((i) => `--${i.flag}: ${i.reason}`).join('; '))
        this.name = 'ArgParseError'
    }
}

const STRING_FLAGS = new Set(['name', 'description', 'preset', 'icon', 'shortcut', 'target'])
const NUMBER_FLAGS = new Set(['nav-order'])
const BOOL_FLAGS = new Set(['server', 'link', 'yes', 'tooling'])
const BOOL_ALIASES: Record<string, string> = { y: 'yes' }

export function parseArgs(argv: readonly string[]): ParsedArgs {
    const out: ParsedArgs = {}
    const positionals: string[] = []
    const issues: FlagError[] = []

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i] ?? ''
        if (!arg.startsWith('-')) {
            positionals.push(arg)
            continue
        }

        const short = arg.startsWith('--') ? arg.slice(2) : arg.slice(1)
        const eqIdx = short.indexOf('=')
        const rawName = eqIdx === -1 ? short : short.slice(0, eqIdx)
        const inlineValue = eqIdx === -1 ? undefined : short.slice(eqIdx + 1)

        const isNegated = rawName.startsWith('no-')
        const baseName = isNegated ? rawName.slice(3) : rawName
        const canonical = BOOL_ALIASES[baseName] ?? baseName

        if (BOOL_FLAGS.has(canonical)) {
            if (inlineValue !== undefined) {
                issues.push({ flag: canonical, reason: 'boolean flag takes no value' })
                continue
            }
            setBool(out, canonical, !isNegated)
            continue
        }

        if (isNegated) {
            issues.push({ flag: rawName, reason: 'not a boolean flag' })
            continue
        }

        if (canonical === 'with') {
            const v = inlineValue ?? argv[++i]
            if (v === undefined || v.startsWith('-')) {
                issues.push({ flag: 'with', reason: 'requires a feature slug' })
                continue
            }
            out.with = out.with ?? []
            out.with.push(v)
            continue
        }

        const value = inlineValue ?? argv[++i]
        if (value === undefined) {
            issues.push({ flag: canonical, reason: 'missing value' })
            continue
        }

        if (STRING_FLAGS.has(canonical)) {
            setString(out, canonical, value)
        } else if (NUMBER_FLAGS.has(canonical)) {
            const n = Number(value)
            if (!Number.isFinite(n)) {
                issues.push({ flag: canonical, reason: `"${value}" is not a number` })
                continue
            }
            setNumber(out, canonical, n)
        } else {
            issues.push({ flag: rawName, reason: 'unknown flag' })
        }
    }

    if (positionals[0] !== undefined) out.slug = positionals[0]
    if (issues.length > 0) throw new ArgParseError(issues)
    return out
}

function setString(out: ParsedArgs, name: string, value: string): void {
    switch (name) {
        case 'name':
            out.name = value
            break
        case 'description':
            out.description = value
            break
        case 'preset':
            if (value !== 'full' && value !== 'settings-only') {
                throw new ArgParseError([
                    { flag: 'preset', reason: `expected "full" or "settings-only", got "${value}"` },
                ])
            }
            out.preset = value
            break
        case 'icon':
            out.icon = value
            break
        case 'shortcut':
            out.shortcut = value
            break
        case 'target':
            out.target = value
            break
    }
}

function setNumber(out: ParsedArgs, name: string, value: number): void {
    if (name === 'nav-order') out.navOrder = value
}

function setBool(out: ParsedArgs, name: string, value: boolean): void {
    switch (name) {
        case 'server':
            out.server = value
            break
        case 'link':
            out.link = value
            break
        case 'yes':
            out.yes = value
            break
        case 'tooling':
            out.tooling = value
            break
    }
}
