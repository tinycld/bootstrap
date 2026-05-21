import { relative, resolve } from 'node:path'
import { cancel, confirm, isCancel, select, text } from '@clack/prompts'
import type { ParsedArgs } from './args.ts'
import { detectLayout } from './layout.ts'
import type { Answers } from './substitute.ts'
import {
    validateDescription,
    validateIcon,
    validateName,
    validateNavOrder,
    validateShortcut,
    validateSlug,
    validateTargetDir,
} from './validate.ts'

function cancelIf<T>(value: T | symbol): T {
    if (isCancel(value)) {
        cancel('Scaffolding cancelled.')
        process.exit(1)
    }
    return value
}

function fail(msg: string): never {
    cancel(msg)
    process.exit(1)
}

function titleCase(slug: string): string {
    return slug
        .split('-')
        .filter(Boolean)
        .map((w) => (w[0]?.toUpperCase() ?? '') + w.slice(1))
        .join(' ')
}

export async function runPrompts(argv: ParsedArgs): Promise<Answers> {
    const skipPrompts = argv.yes === true
    const slug = await resolveSlug(argv.slug, skipPrompts)

    const name = await resolveString({
        argvValue: argv.name,
        validator: validateName,
        skipPrompts,
        defaultValue: titleCase(slug),
        prompt: {
            message: 'Human-readable name',
            initialValue: titleCase(slug),
        },
    })

    const description = await resolveString({
        argvValue: argv.description,
        validator: validateDescription,
        skipPrompts,
        defaultValue: `${titleCase(slug)} for your organization`,
        prompt: {
            message: 'One-sentence description',
            placeholder: `${titleCase(slug)} for your organization`,
        },
    })

    const preset = await resolvePreset(argv.preset, skipPrompts)

    const answers: Answers = {
        slug,
        name,
        description,
        preset,
        targetDir: '',
    }

    if (preset === 'full') {
        answers.icon = await resolveString({
            argvValue: argv.icon,
            validator: validateIcon,
            skipPrompts,
            defaultValue: 'box',
            prompt: { message: 'Lucide icon name', placeholder: 'box', initialValue: 'box' },
        })

        answers.navOrder = await resolveNavOrder(argv.navOrder, skipPrompts)

        answers.navShortcut = await resolveString({
            argvValue: argv.shortcut,
            validator: validateShortcut,
            skipPrompts,
            defaultValue: '',
            prompt: {
                message: 'Keyboard shortcut (single letter, blank to skip)',
                placeholder: '',
                initialValue: '',
            },
        })

        answers.includeServer = await resolveBool({
            argvValue: argv.server,
            skipPrompts,
            defaultValue: true,
            prompt: { message: 'Include a Go server?', initialValue: true },
        })
    }

    answers.targetDir = await resolveTarget(argv.target, slug, skipPrompts)

    return answers
}

async function resolveSlug(fromArgv: string | undefined, skipPrompts: boolean): Promise<string> {
    if (fromArgv) {
        const err = validateSlug(fromArgv)
        if (err) fail(`Invalid slug "${fromArgv}": ${err}`)
        return fromArgv
    }
    if (skipPrompts) fail('Missing slug. Provide it as a positional argument when using --yes.')
    return cancelIf(
        await text({
            message: 'Package slug (kebab-case, e.g. my-feature)',
            validate: (v) => validateSlug(v) ?? undefined,
        })
    )
}

interface StringPromptDef {
    message: string
    initialValue?: string
    placeholder?: string
}

interface ResolveStringInput {
    argvValue: string | undefined
    validator: (v: string) => string | null | undefined
    skipPrompts: boolean
    defaultValue: string
    prompt: StringPromptDef
}

async function resolveString({
    argvValue,
    validator,
    skipPrompts,
    defaultValue,
    prompt,
}: ResolveStringInput): Promise<string> {
    if (argvValue !== undefined) {
        const err = validator(argvValue)
        if (err) fail(`Invalid ${prompt.message.toLowerCase()}: ${err}`)
        return argvValue
    }
    if (skipPrompts) {
        const err = validator(defaultValue)
        if (err) fail(`Invalid default for ${prompt.message.toLowerCase()}: ${err}`)
        return defaultValue
    }
    return cancelIf(
        await text({
            ...prompt,
            validate: (v) => validator(v) ?? undefined,
        })
    )
}

async function resolvePreset(
    fromArgv: 'full' | 'settings-only' | undefined,
    skipPrompts: boolean
): Promise<'full' | 'settings-only'> {
    if (fromArgv) return fromArgv
    if (skipPrompts) return 'full'
    return cancelIf(
        await select({
            message: 'Preset',
            options: [
                {
                    value: 'full' as const,
                    label: 'full — data package (routes, collections, migrations, seed, optional Go server)',
                },
                {
                    value: 'settings-only' as const,
                    label: 'settings-only — just a settings panel (like @tinycld/google-takeout-import)',
                },
            ],
        })
    )
}

async function resolveNavOrder(fromArgv: number | undefined, skipPrompts: boolean): Promise<number> {
    if (fromArgv !== undefined) {
        const err = validateNavOrder(String(fromArgv))
        if (err) fail(`Invalid nav order: ${err}`)
        return fromArgv
    }
    if (skipPrompts) return 20
    const raw = cancelIf(
        await text({
            message: 'Nav order (0–99)',
            initialValue: '20',
            validate: (v) => validateNavOrder(v) ?? undefined,
        })
    )
    return Number(raw)
}

interface ResolveBoolInput {
    argvValue: boolean | undefined
    skipPrompts: boolean
    defaultValue: boolean
    prompt: { message: string; initialValue: boolean }
}

async function resolveBool({ argvValue, skipPrompts, defaultValue, prompt }: ResolveBoolInput): Promise<boolean> {
    if (argvValue !== undefined) return argvValue
    if (skipPrompts) return defaultValue
    return cancelIf(await confirm(prompt))
}

async function resolveTarget(fromArgv: string | undefined, slug: string, skipPrompts: boolean): Promise<string> {
    // Explicit --target always wins. The user knows where they want it.
    if (fromArgv !== undefined) {
        const abs = resolve(fromArgv)
        const err = validateTargetDir(abs)
        if (err) fail(`Invalid target directory: ${err}`)
        return abs
    }

    // No --target: pick a sensible default based on the cwd's existing layout.
    // If cwd is itself a workspace root, attach the new package as a direct
    // child `<cwd>/<slug>`. Otherwise bootstrap a wrapper workspace under
    // `<cwd>/tinycld-<slug>/` and place the package inside it.
    const layout = detectLayout(slug)
    const defaultAbs = layout.targetDir
    const defaultDisplay = `./${relative(process.cwd(), defaultAbs) || slug}`

    if (skipPrompts) {
        const err = validateTargetDir(defaultAbs)
        if (err) fail(`Invalid default target directory: ${err}`)
        return defaultAbs
    }

    const raw = cancelIf(
        await text({
            message: 'Target directory',
            initialValue: defaultDisplay,
            validate: (v) => validateTargetDir(resolve(v)) ?? undefined,
        })
    )
    return resolve(raw)
}
