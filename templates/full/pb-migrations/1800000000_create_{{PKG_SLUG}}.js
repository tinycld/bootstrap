/// <reference path="../pb_data/types.d.ts" />

// Initial migration for {{PKG_SLUG}}. Creates a single `{{PKG_SNAKE}}_items`
// collection matching the shape declared in types.ts / collections.ts.
// Replace or extend this as you build out the package.
//
// Auth rules: every TinyCld collection ships with rules. Without them
// PocketBase falls back to "superusers only" and every insert/select fails
// with "Only superusers can perform this action." The rules below assume a
// user-owned data model — each row has an `owner` relation pointing at the
// `users` collection, and the rule allows access only to that user. This
// matches the pattern used by @tinycld/contacts and friends.
//
// If your data is shared (members of a project, a public share, anything
// else), pick the right rule pattern from the docs:
//   https://tinycld.org/docs/tasks/auth-rules

migrate(
    app => {
        const collection = new Collection({
            type: 'base',
            name: '{{PKG_SNAKE}}_items',
            listRule: 'owner = @request.auth.id',
            viewRule: 'owner = @request.auth.id',
            createRule: 'owner = @request.auth.id',
            updateRule: 'owner = @request.auth.id',
            deleteRule: 'owner = @request.auth.id',
            fields: [
                {
                    name: 'name',
                    type: 'text',
                    required: true,
                    min: 1,
                    max: 200,
                },
                {
                    name: 'owner',
                    type: 'relation',
                    required: true,
                    collectionId: '_pb_users_auth_',
                    cascadeDelete: true,
                    maxSelect: 1,
                },
                {
                    name: 'created',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: false,
                },
                {
                    name: 'updated',
                    type: 'autodate',
                    onCreate: true,
                    onUpdate: true,
                },
            ],
            indexes: [
                'CREATE INDEX `idx_{{PKG_SNAKE}}_items_owner` ON `{{PKG_SNAKE}}_items` (`owner`)',
            ],
        })
        app.save(collection)
    },
    app => {
        const collection = app.findCollectionByNameOrId('{{PKG_SNAKE}}_items')
        app.delete(collection)
    }
)
