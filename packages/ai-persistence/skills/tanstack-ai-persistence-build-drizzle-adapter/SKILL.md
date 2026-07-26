---
name: tanstack-ai-persistence-build-drizzle-adapter
description: Use when building a Drizzle-ORM persistence backend on the @tanstack/ai-persistence core — covers the SQLite and Postgres schemas, the four stores with onConflict idempotency, JSON columns, schema ownership via drizzle-kit, and the edge-safe root vs Node /sqlite split.
---

# Build a Drizzle Persistence Adapter

You want TanStack AI chat state (`messages`, `runs`, `interrupts`, `metadata`)
in a database through Drizzle ORM: better-sqlite3, libsql, D1, `node:sqlite`,
or Postgres (node-postgres, postgres.js, Neon, PGlite). This builds the adapter
on the `@tanstack/ai-persistence` core.

Read the **Build Your Own Adapter** guide
(`docs/persistence/build-your-own-adapter.md`) first for the store contracts and
invariants, and **tanstack-ai-persistence-stores** for the shape rules. This
skill is the Drizzle-specific recipe. Every store here mirrors the reference
in-memory backend in `@tanstack/ai-persistence` (`memory.ts`); the shared
conformance testkit is the proof.

## Package shape

Peer deps: `@tanstack/ai`, `@tanstack/ai-persistence`, `drizzle-orm >=0.44.0`.
Dev deps: `drizzle-kit`. Two entry points:

- the module root takes an already-created, migrated Drizzle DB and imports no
  Node built-ins, so it is safe in edge runtimes (D1);
- a `/sqlite` subpath is a Node-only convenience factory over `node:sqlite`.

Annotate the factory's return as `ChatPersistence` — bare `AIPersistence` is
the all-optional bag and `withPersistence` rejects it.

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
There is no `locks` store — `stores` accepts only those four keys. Consumers
needing coordination wire a `LockStore` separately via `withLocks` (see
**tanstack-ai-persistence-locks**).

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

## Postgres

The same four tables in `drizzle-orm/pg-core`: `jsonb` for the JSON payloads,
`bigint({ mode: 'number' })` for epoch-ms timestamps, and a composite
`primaryKey` on `(scope, key)` for metadata. The store bodies are
unchanged — only the column builders and the `onConflictDoUpdate` target types
differ. Take a `provider: 'sqlite' | 'pg'` option, declare it with overloads so
`db` and `schema` must agree, and add a runtime dialect check so a mismatched
pair fails at construction rather than on first query.

## Schema ownership: schema-first, no bundled SQL

**Do not ship SQL migrations or a migration runner.** The consumer owns the DDL
and their `drizzle-kit` journal; inventing a parallel migration table behind
their back is how schemas drift. Give them two supported paths:

1. **Re-export the stock tables** from a `/sqlite-schema` or `/pg-schema`
   subpath, so their `drizzle-kit` config picks the tables up and generates the
   migration into their own journal. Tracks upstream table changes on upgrade.
2. **Emit an owned starter** with a small schema CLI
   (`tanstack-ai-drizzle-schema [--dialect pg]`) that writes the schema file
   into their repo. They own it from then on — free to rename tables, add
   columns, tune indexes.

Let a consumer pass their own `{ schema }` to `drizzlePersistence(db, { schema })`.
Because the stores read database names off the table objects, a renamed table or
an extra app-owned column (a `userId` on `messages`) works through the same code.
Validate the passed tables/columns exist at construction, and pin the required
column data shapes with a compile-time schema contract type. Pick **one** DDL
owner per database.

For a zero-config local dev path, an `ensureTables(db)` helper that issues
`CREATE TABLE IF NOT EXISTS` is fine — keep it opt-in (`migrate: true`) and
clearly separate from the consumer's journal.

## Verify

```ts ignore
import { runPersistenceConformance } from '@tanstack/ai-persistence/testkit'

runPersistenceConformance('drizzle-sqlite', () =>
  sqlitePersistence({ url: ':memory:', migrate: true }),
)
```

Run it once per dialect. Every store is provided, so there is nothing to
`skip` — and `skip` never accepts `'locks'`, which is not a state store.
