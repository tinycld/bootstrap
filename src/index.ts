#!/usr/bin/env node
import { relative } from 'node:path'
import { intro, outro } from '@clack/prompts'
import pc from 'picocolors'
import { ArgParseError, parseArgs } from './args.ts'
import { copyTemplate, resolveTemplatesRoot } from './copy-template.ts'
import { offerLinkPackage } from './link-package.ts'
import { runPrompts } from './prompts.ts'

async function main(): Promise<void> {
    intro(pc.bold(pc.cyan('@tinycld/create-package')))

    let args: ReturnType<typeof parseArgs>
    try {
        args = parseArgs(process.argv.slice(2))
    } catch (err) {
        if (err instanceof ArgParseError) {
            console.error(pc.red('Bad arguments:'))
            for (const issue of err.issues) {
                console.error(`  --${issue.flag}: ${issue.reason}`)
            }
            process.exit(2)
        }
        throw err
    }

    const answers = await runPrompts(args)

    copyTemplate(resolveTemplatesRoot(import.meta.url), answers)

    const linked = await offerLinkPackage({
        packageName: answers.slug,
        targetDir: answers.targetDir,
        mode: resolveLinkMode(args),
    })

    const relTarget = relative(process.cwd(), answers.targetDir) || answers.targetDir
    outro(pc.green(`Scaffolded ${pc.bold(answers.slug)} at ${pc.bold(relTarget)}`))

    printNextSteps({ slug: answers.slug, relTarget, linked })
}

function resolveLinkMode(args: ReturnType<typeof parseArgs>): 'prompt' | 'accept' | 'skip' {
    if (args.link === false) return 'skip'
    if (args.link === true) return 'accept'
    if (args.yes === true) return 'accept'
    return 'prompt'
}

interface NextStepsInput {
    slug: string
    relTarget: string
    linked: boolean
}

function printNextSteps({ slug, relTarget, linked }: NextStepsInput): void {
    const lines: string[] = ['', pc.bold('Next steps:'), '']
    let step = 1

    lines.push(`  ${pc.dim(`# ${step++}. Initialize git and push to GitHub`)}`)
    lines.push(`  cd ${relTarget}`)
    lines.push('  git init')
    lines.push('  git add .')
    lines.push("  git commit -m 'chore: initial scaffold'")
    lines.push(`  gh repo create tinycld/${slug} --public --source=. --push`)
    lines.push('')

    if (!linked) {
        lines.push(`  ${pc.dim(`# ${step++}. Link into the tinycld app shell`)}`)
        lines.push('  cd ../tinycld')
        lines.push(`  bun run packages:link ../${slug}`)
        lines.push('')
    }

    lines.push(`  ${pc.dim(`# ${step++}. Verify`)}`)
    lines.push('  bun run checks')
    lines.push('')

    lines.push(`  ${pc.dim(`# ${step++}. Run the app (Expo + PocketBase)`)}`)
    if (!linked) lines.push('  cd ../tinycld')
    lines.push('  bun run start')
    lines.push('')

    console.log(lines.join('\n'))
}

main().catch((err) => {
    console.error(pc.red('Error:'), err?.message ?? err)
    process.exit(1)
})
