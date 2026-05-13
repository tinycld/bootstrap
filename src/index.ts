#!/usr/bin/env node
import { dirname, relative } from 'node:path'
import { intro, outro } from '@clack/prompts'
import pc from 'picocolors'
import { ArgParseError, parseArgs } from './args.ts'
import { copyTemplate, resolveTemplatesRoot } from './copy-template.ts'
import { detectLayout } from './layout.ts'
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

    // Re-derive the layout from the resolved target so the next-steps output
    // matches whatever path the user actually ended up at (default detection,
    // explicit --target, or interactive override). The wrapper's parent dir
    // names where `cd ../tinycld` lands.
    const layout = detectLayoutFromTarget(answers.targetDir, answers.slug)
    printNextSteps({ slug: answers.slug, relTarget, linked, layout })
}

function detectLayoutFromTarget(targetDir: string, slug: string): 'attach' | 'bootstrap' {
    // If cwd has a tinycld/ child (workspace mode) and target is a sibling of
    // that tinycld, we're in attach mode. Otherwise the scaffolder created a
    // wrapper under cwd and dropped tinycld inside it (bootstrap mode).
    const detected = detectLayout(slug)
    if (detected.mode === 'attach' && targetDir === detected.targetDir) return 'attach'
    if (detected.mode === 'bootstrap' && targetDir === detected.targetDir) return 'bootstrap'
    // User passed an explicit --target. Infer from the on-disk shape: if the
    // parent of targetDir has a `tinycld` child, treat as attach.
    const parent = dirname(targetDir)
    const looksAttached = detectLayout(slug, parent).mode === 'attach'
    return looksAttached ? 'attach' : 'bootstrap'
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
    layout: 'attach' | 'bootstrap'
}

function printNextSteps({ slug, relTarget, linked, layout }: NextStepsInput): void {
    const lines: string[] = ['', pc.bold('Next steps:'), '']
    let step = 1

    if (layout === 'bootstrap') {
        // Highlight that the scaffolder also dropped a tinycld checkout
        // alongside the new package. New users may not realize they just
        // got a self-contained workspace.
        lines.push(
            pc.dim(
                `  Scaffolded a self-contained workspace alongside the package.\n  The tinycld app shell lives at ./${dirname(relTarget)}/tinycld/.\n`
            )
        )
    }

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
        lines.push(`  pnpm run packages:link ../${slug}`)
        lines.push('')
    }

    lines.push(`  ${pc.dim(`# ${step++}. Verify (biome + tsc run from the app shell and cover the linked package)`)}`)
    if (linked) lines.push('  cd ../tinycld')
    lines.push('  pnpm run checks')
    lines.push('')

    lines.push(`  ${pc.dim(`# ${step++}. Run the app (Expo + PocketBase, single-port dev proxy)`)}`)
    lines.push('  pnpm run start')
    lines.push('')

    console.log(lines.join('\n'))
}

main().catch((err) => {
    console.error(pc.red('Error:'), err?.message ?? err)
    process.exit(1)
})
