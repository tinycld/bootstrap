#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { pathToFileURL } from 'node:url'
import { intro, outro } from '@clack/prompts'
import pc from 'picocolors'
import { ArgParseError, parseArgs } from './args.ts'
import { type BootstrapToolingOptions, bootstrapTooling } from './bootstrap-tooling.ts'
import { copyTemplate, resolveTemplatesRoot } from './copy-template.ts'
import { detectLayout } from './layout.ts'
import { offerLinkPackage } from './link-package.ts'
import { runPrompts } from './prompts.ts'

export function runToolingMode(opts: BootstrapToolingOptions): void {
    const root = opts.root ?? process.cwd()
    // Honor TINYCLD_REPO_BASE (CI sets it to an HTTPS base since runners have no
    // SSH key). Listed first so an explicit opts.repoBase still wins via spread;
    // when neither is set, bootstrapTooling falls back to its SSH default.
    const present = bootstrapTooling({
        repoBase: process.env.TINYCLD_REPO_BASE,
        ...opts,
        root,
    })
    // Mandatory members must clone — a missing app/core means a broken workspace.
    for (const required of ['app', 'core']) {
        if (!present.includes(required)) {
            throw new Error(`Failed to clone required member '${required}'. Check network/auth and retry.`)
        }
    }
    console.log(`Workspace skeleton ready at ${root} (members: ${present.join(', ')})`)
}

async function main(): Promise<void> {
    intro(pc.bold(pc.cyan('@tinycld/bootstrap')))

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

    if (args.tooling) {
        runToolingMode({ root: process.cwd(), members: args.with })
        outro(
            pc.green(
                `Tooling-only workspace assembled (app + core${
                    args.with?.length ? `, ${args.with.join(', ')}` : ''
                }). Run \`npm install\` at the root.`
            )
        )
        return
    }

    const answers = await runPrompts(args)

    copyTemplate(resolveTemplatesRoot(import.meta.url), answers)

    // The package lives at `<workspaceDir>/<slug>`, so its parent is the
    // workspace dir in both attach (cwd) and bootstrap (wrapper) modes.
    const linked = await offerLinkPackage({
        slug: answers.slug,
        workspaceDir: dirname(answers.targetDir),
        mode: resolveLinkMode(args),
    })

    const relTarget = relative(process.cwd(), answers.targetDir) || answers.targetDir
    outro(pc.green(`Scaffolded ${pc.bold(answers.slug)} at ${pc.bold(relTarget)}`))

    // Re-derive the layout from the resolved target so the next-steps output
    // matches whatever path the user actually ended up at (default detection,
    // explicit --target, or interactive override). It decides whether to print
    // the bootstrap "self-contained workspace" note.
    const layout = detectLayoutFromTarget(answers.targetDir, answers.slug)
    printNextSteps({ slug: answers.slug, relTarget, linked, layout })
}

function detectLayoutFromTarget(targetDir: string, slug: string): 'attach' | 'bootstrap' {
    // If cwd is itself a workspace root and target is a direct child of it,
    // we're in attach mode. Otherwise the scaffolder created a wrapper under
    // cwd and the workspace meta-repo gets cloned inside it (bootstrap mode).
    const detected = detectLayout(slug)
    if (detected.mode === 'attach' && targetDir === detected.targetDir) return 'attach'
    if (detected.mode === 'bootstrap' && targetDir === detected.targetDir) return 'bootstrap'
    // User passed an explicit --target. Infer from the on-disk shape: if the
    // parent of targetDir is itself a workspace root, treat as attach.
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

    // The workspace root, relative to cwd. In bootstrap mode the package sits at
    // `<wrapper>/<slug>`, so the wrapper (`dirname(relTarget)`) is the workspace
    // root. In attach mode cwd already IS the workspace root, so it's `.`.
    const wsRoot = dirname(relTarget) || '.'

    if (layout === 'bootstrap') {
        // The meta-repo was cloned into the wrapper, so the wrapper itself is the
        // workspace root and the new package is a member directory inside it.
        // New users may not realize they just got a self-contained workspace.
        lines.push(
            pc.dim(
                `  Scaffolded a self-contained tinycld workspace.\n  The workspace root is ./${wsRoot}/ and your package is ./${relTarget}/.\n  The app member (Expo + PocketBase) is ./${wsRoot}/app/.\n`
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
        // Linking is now a workspace-root `npm install`: the package dir already
        // exists; add it to the root package.json `workspaces` if it isn't a
        // member yet, then install — npm symlinks it and the postinstall runs
        // the generator.
        lines.push(`  ${pc.dim(`# ${step++}. Link into the workspace (add as a member, then install)`)}`)
        if (wsRoot !== '.') lines.push(`  cd ${wsRoot}`)
        lines.push(`  # ensure "${slug}" is in this package.json's "workspaces" array, then:`)
        lines.push('  npm install')
        lines.push('')
    }

    lines.push(`  ${pc.dim(`# ${step++}. Verify the package (biome + tsc, scoped to this member)`)}`)
    lines.push(`  cd ${join(wsRoot, slug)}`)
    lines.push('  npx tinycld-pkg check')
    lines.push('')

    lines.push(`  ${pc.dim(`# ${step++}. Run the app (Expo + PocketBase, single-port dev proxy)`)}`)
    lines.push(`  cd ${join(wsRoot, 'app')}`)
    lines.push('  npm run dev')
    lines.push('')

    console.log(lines.join('\n'))
}

function isEntrypoint(): boolean {
    const argv1 = process.argv[1]
    if (!argv1) return false
    try {
        return import.meta.url === pathToFileURL(realpathSync(argv1)).href
    } catch {
        return false
    }
}

if (isEntrypoint()) {
    main().catch((err) => {
        console.error(pc.red('Error:'), err?.message ?? err)
        process.exit(1)
    })
}
