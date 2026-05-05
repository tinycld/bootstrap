// Schema types for this package, merged into core's MergedSchema by the
// generator. Each entry maps a pbtsdb collection name to its record type
// and optional relations. Rename, replace, or delete {{PKG_SNAKE}}_items
// when you wire up your first real collection.

export interface {{PKG_PASCAL}}Item {
    id: string
    name: string
    owner: string
    created: string
    updated: string
}

export type {{PKG_PASCAL}}Schema = {
    {{PKG_SNAKE}}_items: {
        type: {{PKG_PASCAL}}Item
    }
}
