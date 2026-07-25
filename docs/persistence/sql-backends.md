---
title: SQL Backends
id: sql-backends
---

# SQL Backends

TanStack AI ships two SQL-oriented state adapters with different ownership
models.

| Adapter | Database support | Connection ownership | Schema workflow |
| --- | --- | --- | --- |
| `@tanstack/ai-persistence-drizzle` | SQLite-family | Bring a migrated Drizzle DB, or use Node `/sqlite` | Emit schema via CLI; your drizzle-kit owns migrations |
| `@tanstack/ai-persistence-prisma` | Providers supported by your Prisma schema | Bring your generated `PrismaClient` | Copy models fragment, then use Prisma migrate |

The Drizzle adapter does not ship SQL migrations. Pass a required `schema` to
`drizzlePersistence`. For a non-SQLite Drizzle database, implement the public
`AIPersistence` store interfaces for that dialect (or use Prisma).

## Local SQLite

```ts
import { sqlitePersistence } from '@tanstack/ai-persistence-drizzle/sqlite'

export const persistence = sqlitePersistence({
  url: 'file:.tanstack-ai/state.sqlite',
})
```

Uses the default schema and runtime table bootstrap. For production, emit the
schema, migrate with drizzle-kit, and pass `{ schema, ensureTables: false }`.

## Existing SQLite or D1 Drizzle database

```ts ignore
import { drizzle } from 'drizzle-orm/d1'
import {
  createDefaultSqliteSchema,
  drizzlePersistence,
} from '@tanstack/ai-persistence-drizzle'

export function createPersistence(state: D1Database) {
  const schema = createDefaultSqliteSchema()
  return drizzlePersistence(drizzle(state, { schema }), {
    provider: 'sqlite',
    schema,
  })
}
```

The package root is edge-safe; `/sqlite` is Node-only. Prefer a project-owned
schema from `tanstack-ai-drizzle-schema` over the default factory when you run
drizzle-kit.

## Prisma

```ts ignore
import { PrismaClient } from '@prisma/client'
import { prismaPersistence } from '@tanstack/ai-persistence-prisma'

const prisma = new PrismaClient()
export const persistence = prismaPersistence(prisma)
```

Copy the package's models fragment and create provider-native migrations before
constructing the adapter. See [Prisma](./prisma).

## Store coverage

Both adapters provide **state** stores: messages, runs, interrupts, and
metadata. Locks are a separate concern — when multiple processes can mutate the
same critical section, add `withLocks` with a distributed `LockStore`:

```ts
import { withPersistence, withLocks } from '@tanstack/ai-persistence'
import { persistence } from './persistence'
import { distributedLocks } from './locks'

middleware: [
  withPersistence(persistence),
  withLocks(distributedLocks),
]
```

For Cloudflare D1, use the Drizzle SQLite path above (or the thin
`cloudflarePersistence({ d1 })` wrapper). Durable Object locks live in
[Cloudflare Persistence](./cloudflare). For another SQL library, start with
[Custom Stores](./custom-stores).
