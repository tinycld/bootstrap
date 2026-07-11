import { existsSync, readdirSync, statSync } from 'node:fs'

const SLUG_RE = /^[a-z][a-z0-9-]*[a-z0-9]$/
const RESERVED_SLUGS = new Set(['core', 'main', 'test', 'tests', 'node_modules', 'packages'])
const SHORTCUT_RE = /^[a-z]$/
const ICON_RE = /^[a-z][a-z0-9-]*$/

// Free-text fields (name, description) are substituted VERBATIM into single-quoted
// TS strings, JSON, JSX text, and Go/Markdown comments in the generated scaffold.
// Quotes, backslashes, backticks, template-literal openers, and control chars
// (newlines/tabs) would break — or inject into — that output. Reject them so the
// user re-runs with a clean value; escaping correctly per-context is far more
// fragile than disallowing characters that have no business in a package name.
const UNSAFE_CHARS = ["'", '"', '`', '\\'] as const

function hasControlChar(value: string): boolean {
    for (let i = 0; i < value.length; i++) {
        const code = value.charCodeAt(i)
        if (code < 0x20 || code === 0x7f) return true
    }
    return false
}

function validateFreeText(value: string): string | null {
    if (hasControlChar(value)) return 'must not contain newlines, tabs, or other control characters'
    if (value.includes('${')) return 'must not contain "${" (template-literal syntax)'
    for (const ch of UNSAFE_CHARS) {
        if (value.includes(ch)) return `must not contain the ${ch} character`
    }
    return null
}

export function validateSlug(slug: string): string | null {
    if (!slug || slug.length < 3) return 'Slug must be at least 3 characters'
    if (slug.length > 40) return 'Slug must be 40 characters or fewer'
    if (!SLUG_RE.test(slug)) {
        return 'Slug must be kebab-case (lowercase letters, digits, hyphens; no leading/trailing hyphen)'
    }
    if (RESERVED_SLUGS.has(slug)) return `"${slug}" is reserved`
    return null
}

export function validateName(name: string): string | null {
    if (!name || name.trim().length === 0) return 'Name is required'
    if (name.length > 60) return 'Name must be 60 characters or fewer'
    const err = validateFreeText(name)
    if (err) return `Name ${err}`
    return null
}

export function validateDescription(desc: string): string | null {
    if (!desc || desc.trim().length === 0) return 'Description is required'
    if (desc.length > 200) return 'Description must be 200 characters or fewer'
    const err = validateFreeText(desc)
    if (err) return `Description ${err}`
    return null
}

export function validateIcon(icon: string): string | null {
    if (!icon || icon.length === 0) return null // optional
    if (!ICON_RE.test(icon)) return 'Icon must be a lucide-react-native name (lowercase, hyphens)'
    return null
}

export function validateNavOrder(raw: string): string | null {
    const n = Number(raw)
    if (!Number.isInteger(n)) return 'Nav order must be an integer'
    if (n < 0 || n > 99) return 'Nav order must be between 0 and 99'
    return null
}

export function validateShortcut(s: string): string | null {
    if (!s || s.length === 0) return null // optional
    if (!SHORTCUT_RE.test(s)) return 'Shortcut must be a single lowercase letter'
    return null
}

export function validateTargetDir(dir: string): string | null {
    if (!existsSync(dir)) return null
    const stat = statSync(dir)
    if (!stat.isDirectory()) return `${dir} exists and is not a directory`
    const entries = readdirSync(dir).filter((n) => n !== '.DS_Store')
    if (entries.length > 0) return `${dir} exists and is not empty`
    return null
}
