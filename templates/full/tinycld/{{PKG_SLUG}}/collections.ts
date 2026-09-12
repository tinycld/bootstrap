import type { CoreStores } from '@tinycld/core/lib/pocketbase'
import type { Schema } from '@tinycld/core/types/pbSchema'
import type { createCollection } from 'pbtsdb/core'
import { BasicIndex } from 'pbtsdb/core'
import type { {{PKG_PASCAL}}Schema } from './types'

// Replace (not intersect) the generated entries for this package's own
// collections — a plain intersection would merge each overlapping entry
// field-wise, letting a generated `any` absorb any typed override.
type MergedSchema = Omit<Schema, keyof {{PKG_PASCAL}}Schema> & {{PKG_PASCAL}}Schema

// Collections contributed by this package. Core calls this during pbtsdb
// bootstrap; the returned object's keys become top-level keys on the app's
// MergedSchema (accessible via `useStore('...')`).
export function registerCollections(
    newCollection: ReturnType<typeof createCollection<MergedSchema>>,
    _core: CoreStores
) {
    // Hoisted rather than inlined: an inline `collectionOptions` object literal
    // defeats inference of `alwaysExpand` against `relations`, typing every
    // expand path as `never`.
    const indexing = {
        autoIndex: 'eager' as const,
        defaultIndexType: BasicIndex,
    }

    // To auto-expand a relation, declare where its expanded records go with
    // `relations`, then list the paths to fetch on every request:
    //     relations: { owner: _core.users },
    //     alwaysExpand: ['owner'],
    // Declare `relations` alone (no `alwaysExpand`) to expand per query instead:
    //     collection.expand('owner')
    const {{PKG_SNAKE}}_items = newCollection('{{PKG_SNAKE}}_items', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexing,
    })

    return {
        {{PKG_SNAKE}}_items,
    }
}
