---
name: tanstack-ai-persistence-build-drizzle-adapter
description: Use when building a Drizzle-ORM SQLite persistence backend on the @tanstack/ai-persistence core — covers the schema, the four stores with onConflict idempotency, JSON columns, bundled migrations, and the edge-safe root vs Node /sqlite split.
---

# Build a Drizzle Persistence Adapter

You want TanStack AI chat state (`messages`, `runs`, `interrupts`, `metadata`)
in a SQLite-family database through Drizzle ORM: better-sqlite3, libsql, D1,
`node:sqlite`. This builds the adapter on the `@tanstack/ai-persistence` core.

Read the **Build Your Own Adapter** guide
(`docs/persistence/build-your-own-adapter.md`) first for the store contracts and
invariants. This skill is the Drizzle-specific recipe. Every store here mirrors
the reference in-memory backend in
`@tanstack/ai-persistence` (`memory.ts`); the shared conformance testkit is the
proof.

## Package shape

Peer deps: `@tanstack/ai`, `@tanstack/ai-persistence`, `drizzle-orm >=0.44.0`.
Dev deps: `drizzle-kit`. Two entry points:

- the package root takes an already-created, migrated Drizzle DB and imports no
  Node built-ins, so it is safe in edge runtimes (D1);
- a `/sqlite` subpath is a Node-only convenience factory over `node:sqlite`.

## Schema

Use `drizzle-orm/sqlite-core`. JSON payloads use `text({ mode: 'json' })` so
Drizzle round-trips objects for you. Timestamps are `integer` (epoch ms).

```ts ignore
import { integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import type { ModelMessage, TokenUsage } from '@tanstack/ai'
import type { InterruptRecord, RunStatus } from '@tanstack/ai-persistence'

export const messages = sqliteTable('messages', {
  threadId: text('thread_id').primaryKey(),
  messagesJson: text('messages_json', { mode: 'json' })
    .$type<Array<ModelMessage>>()
    .notNull(),
})

export const runs = sqliteTable('runs', {
  runId: text('run_id').primaryKey(),
  threadId: text('thread_id').notNull(),
  status: text('status').$type<RunStatus>().notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  error: text('error'),
  usageJson: text('usage_json', { mode: 'json' }).$type<TokenUsage>(),
})

export const interrupts = sqliteTable('interrupts', {
  interruptId: text('interrupt_id').primaryKey(),
  runId: text('run_id').notNull(),
  threadId: text('thread_id').notNull(),
  status: text('status').$type<InterruptRecord['status']>().notNull(),
  requestedAt: integer('requested_at').notNull(),
  resolvedAt: integer('resolved_at'),
  payloadJson: text('payload_json', { mode: 'json' })
    .$type<Record<string, unknown>>()
    .notNull(),
  responseJson: text('response_json', { mode: 'json' }).$type<unknown>(),
})

export const metadata = sqliteTable(
  'metadata',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    valueJson: text('value_json', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.key] })],
)

export const schema = { messages, runs, interrupts, metadata }
```

## Stores: the idempotency rules are the whole game

Type the `db` as the schema-agnostic slice you use, so a BYO `db` built with any
`{ schema }` is assignable:

```ts ignore
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'

export type DrizzleSqliteDb = Pick<
  BaseSQLiteDatabase<'sync' | 'async', unknown>,
  'select' | 'insert' | 'update' | 'delete'
>
```

- **messages**: `saveThread` is `insert(...).onConflictDoUpdate(...)` on
  `threadId`. `loadThread` returns `rows[0]?.messagesJson ?? []`.
- **runs**: `createOrResume` reads first, returns the existing record unchanged
  if present, else `insert(...).onConflictDoNothing({ target: runs.runId })`.
  `update` builds a partial `set` and no-ops when empty.
- **interrupts**: `create` is `insert(...).onConflictDoNothing(...)` — never
  overwrite an already-resolved interrupt. `resolve`/`cancel` set
  `resolvedAt: Date.now()`. Every `list*` ends with
  `.orderBy(asc(interrupts.requestedAt))`.
- **metadata**: reject nullish before insert. `text({ mode: 'json' })` binds a
  JS `null` as SQL NULL (never the text `"null"`), which violates the NOT NULL
  column, so throw a clear `TypeError` and tell callers to use `delete`.

Map rows back with helpers that omit absent optionals so records compare cleanly:

```ts ignore
function mapRun(row: typeof runs.$inferSelect): RunRecord {
  return {
    runId: row.runId,
    threadId: row.threadId,
    status: row.status,
    startedAt: row.startedAt,
    ...(row.finishedAt != null ? { finishedAt: row.finishedAt } : {}),
    ...(row.error != null ? { error: row.error } : {}),
    ...(row.usageJson != null ? { usage: row.usageJson } : {}),
  }
}
```

Assemble with `defineAIPersistence({ stores: { messages, runs, interrupts, metadata } })`.
There is no `locks` store; consumers that need one compose it in.

## Node /sqlite factory

The `/sqlite` entry opens `node:sqlite`, optionally applies bundled migrations,
and wraps it in a Drizzle proxy:

```ts ignore
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/sqlite-proxy'

export function sqlitePersistence(options: { url: string; migrate?: boolean }) {
  const sqlite = new DatabaseSync(options.url)
  if (options.migrate) applySqliteMigrations(sqlite, sqliteMigrations)
  const db = drizzle((sql, params, method) => {
    const stmt = sqlite.prepare(sql)
    if (method === 'run') return (stmt.run(...params), { rows: [] })
    if (method === 'get') {
      const row = stmt.get(...params)
      return { rows: row ? Object.values(row) : [] }
    }
    return { rows: stmt.all(...params).map((r) => Object.values(r)) }
  })
  return drizzlePersistence(db)
}
```

## Migrations

Generate SQL with `drizzle-kit` from the schema, then embed the canonical `.sql`
as a raw string in an ordered `sqliteMigrations: Array<{ id, filename, sql }>`.
Apply each migration and its bookkeeping insert in one transaction against a
`__tanstack_ai_migrations` table, so a failure leaves no partial schema. Ship a
CLI (`tanstack-ai-drizzle-migrations`) that copies the SQL out, and a
package-contract test that keeps the embedded asset byte-identical to the
drizzle-kit output.

## Own the schema

Let a consumer pass their own `{ schema }` to `drizzlePersistence(db, { schema })`.
Because the stores read database names off the table objects, a renamed table or
an extra app-owned column (a `userId` on `messages`) works through the same code.
Validate the passed tables/columns exist at construction, and keep the required
column data shapes with a compile-time schema type. Pick one DDL owner per
database: the bundled SQL or the consumer's drizzle-kit journal, not both.

## Verify

```ts ignore
import { runPersistenceConformance } from '@tanstack/ai-persistence/testkit'

runPersistenceConformance(
  'drizzle-sqlite',
  () => sqlitePersistence({ url: ':memory:', migrate: true }),
  { skip: ['locks'] },
)
```
