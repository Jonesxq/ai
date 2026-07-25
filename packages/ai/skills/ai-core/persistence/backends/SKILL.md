---
name: ai-core/persistence/backends
description: >
  Choose and wire packaged persistence backends: memoryPersistence,
  Drizzle (sqlite/pg/schema-first), Prisma models fragment, Cloudflare D1
  thin wrapper + Durable Object locks. Schema ownership, migrations, compose.
  Use when picking a store implementation — not when implementing custom
  interfaces (see custom-stores).
type: sub-skill
library: tanstack-ai
library_version: '0.10.0'
sources:
  - 'TanStack/ai:docs/persistence/drizzle.md'
  - 'TanStack/ai:docs/persistence/prisma.md'
  - 'TanStack/ai:docs/persistence/cloudflare.md'
  - 'TanStack/ai:docs/persistence/sql-backends.md'
  - 'TanStack/ai:docs/persistence/migrations.md'
---

# Persistence Backends

> Builds on **ai-core/persistence/server**. All backends implement
> `ChatPersistence` / `AIPersistence` for `withPersistence(...)`.

## Quick pick

| Backend               | Factory                                              | Import                                    | Best for                       |
| --------------------- | ---------------------------------------------------- | ----------------------------------------- | ------------------------------ |
| In-memory             | `memoryPersistence()`                                | `@tanstack/ai-persistence`                | Dev, tests                     |
| Drizzle SQLite (Node) | `sqlitePersistence({ url })`                         | `@tanstack/ai-persistence-drizzle/sqlite` | Local/prod file SQLite         |
| Drizzle (edge-safe)   | `drizzlePersistence(db, { provider, schema })`       | `@tanstack/ai-persistence-drizzle`        | D1, libsql, any BYO Drizzle    |
| Drizzle Postgres      | `drizzlePersistence(db, { provider: 'pg', schema })` | same                                      | Neon, node-postgres, PGlite, … |
| Prisma                | `prismaPersistence(prisma)`                          | `@tanstack/ai-persistence-prisma`         | Existing Prisma apps           |
| Cloudflare D1         | `cloudflarePersistence({ d1 })`                      | `@tanstack/ai-persistence-cloudflare`     | Workers + stock schema         |

Every packaged backend provides **all four** state stores: messages, runs,
interrupts, metadata. Locks are separate (see **persistence/locks**).

## In-memory

```ts
import { memoryPersistence, withPersistence } from '@tanstack/ai-persistence'

middleware: [withPersistence(memoryPersistence())]
```

Process-local only. Fine for demos and unit tests; not multi-instance.

## Drizzle (schema-first)

The package **does not ship SQL migrations**. You own the schema file and
drizzle-kit journal.

### Local Node convenience

```ts
import { sqlitePersistence } from '@tanstack/ai-persistence-drizzle/sqlite'

const persistence = sqlitePersistence({
  url: 'file:.tanstack-ai/state.sqlite', // or ':memory:'
  // ensureTables: true by default — bootstrap only, not production migrations
})
```

Production: emit schema, migrate with drizzle-kit, pass
`{ schema, ensureTables: false }`.

### Stock tables (no copy)

```ts
// src/db/tanstack-ai-schema.ts
export * from '@tanstack/ai-persistence-drizzle/sqlite-schema'
// or .../pg-schema for Postgres
```

Add to drizzle-kit `schema` paths → `generate` / `migrate`.

### Owned starter

```bash
pnpm exec tanstack-ai-drizzle-schema --out src/db
# Postgres: --dialect pg
```

Rename tables/columns, add nullable/defaulted app columns (e.g. `user_id`),
tune indexes. Keep contract column **data shapes**.

### Runtime (edge-safe root)

```ts
import { drizzlePersistence } from '@tanstack/ai-persistence-drizzle'
import { schema } from './db/tanstack-ai-schema'
import { db } from './db'

export const persistence = drizzlePersistence(db, {
  provider: 'sqlite', // or 'pg'
  schema,
})
```

`provider` must match `db` dialect (compile-time overloads + runtime check).
Table objects are **injected** — physical SQL names come from your schema.

### Cloudflare D1

D1 is SQLite. Prefer the same schema-first path:

```ts
import { drizzle } from 'drizzle-orm/d1'
import { drizzlePersistence } from '@tanstack/ai-persistence-drizzle'
import { schema } from './db/tanstack-ai-schema'

export function createPersistence(env: { AI_STATE: D1Database }) {
  return drizzlePersistence(drizzle(env.AI_STATE, { schema }), {
    provider: 'sqlite',
    schema,
  })
}
```

Or stock schema via `cloudflarePersistence({ d1 })` — still migrate tables
yourself (Wrangler `migrations_dir` ← your drizzle-kit output). The Cloudflare
package does **not** ship D1 SQL.

## Prisma

```bash
pnpm exec tanstack-ai-prisma-models --out prisma/schema
# merge fragment into schema, then:
pnpm prisma migrate dev
pnpm prisma generate
```

```ts
import { PrismaClient } from '@prisma/client'
import { prismaPersistence } from '@tanstack/ai-persistence-prisma'

const prisma = new PrismaClient()
export const persistence = prismaPersistence(prisma)
// or map renamed models via the package's model map options
```

## Compose overrides

Swap or remove individual stores without rewriting the backend:

```ts
import { composePersistence } from '@tanstack/ai-persistence'
import { cloudflarePersistence } from '@tanstack/ai-persistence-cloudflare'

return composePersistence(cloudflarePersistence({ d1 }), {
  overrides: {
    interrupts: myInterruptStore,
    metadata: false, // drop store
  },
})
```

Composition is **not** a distributed transaction across systems.

## Migrations discipline

1. Prefer re-export stock schema / models when you do not customize.
2. Emit/copy starters only when you need renames or extra columns.
3. Generate DDL with **your** tool (drizzle-kit, Prisma migrate).
4. Apply migrations before deploying code that depends on new columns.
5. Do not dual-maintain hand SQL next to a Drizzle/Prisma schema.

## Cross-references

- **ai-core/persistence/server** — `withPersistence` wiring
- **ai-core/persistence/custom-stores** — full custom backends
- **ai-core/persistence/locks** — DO / in-memory locks
