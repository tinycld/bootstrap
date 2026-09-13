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
    // defeats inference of `alwaysFetchRelations` against `relations`, typing every
    // expand path as `never`.
    const indexing = {
        autoIndex: 'eager' as const,
        defaultIndexType: BasicIndex,
    }

    // `relations` declares where PocketBase's expanded records are filed. Rows
    // never carry `expand`; read a relation from its own collection, with
    // `materialize()` in a select, a join, or `collection.get(id)`.
    //     relations: { owner: _core.users },
    // Add `alwaysFetchRelations: ['owner']` only when this collection is the
    // sole path by which rows enter an ON-DEMAND target — an eager target syncs
    // itself, so fetching its relation only adds payload. For one query,
    // use `collection.fetchRelations('owner')` instead.
    const {{PKG_SNAKE}}_items = newCollection('{{PKG_SNAKE}}_items', {
        omitOnInsert: ['created', 'updated'] as const,
        collectionOptions: indexing,
    })

    return {
        {{PKG_SNAKE}}_items,
    }
}
