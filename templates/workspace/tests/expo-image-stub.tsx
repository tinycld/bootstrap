// Test-only stub for expo-image. The real package transitively imports
// expo-modules-core, whose module-load-time side effects (e.g. reading
// the `__DEV__` global) don't survive a bare Node test environment.
// Tests that pull a component importing <Image> only need a harmless
// placeholder — they assert on logic, not on rendered pixels.

import type { ReactElement } from 'react'

export function Image(_props: unknown): ReactElement | null {
    return null
}
