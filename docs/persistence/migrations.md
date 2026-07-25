---
title: Persistence Migrations
id: migrations
---

# Persistence Migrations

Migration ownership depends on the backend. Apply schema changes before
deploying code that reads or writes the corresponding stores.

## Drizzle SQLite

The Drizzle package is **schema-first** and does **not** ship SQL migrations.
Own the schema in your project, then generate DDL with drizzle-kit:

```bash
pnpm exec tanstack-ai-drizzle-schema --out src/db
```

Point drizzle-kit at the emitted file, generate, and migrate:

```ts ignore
import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'sqlite',
  schema: ['./src/db/schema.ts', './src/db/tanstack-ai-schema.ts'],
  out: './drizzle',
})
```

```bash
pnpm exec drizzle-kit generate
pnpm exec drizzle-kit migrate
```

Pass the schema into the runtime:

```ts
import { drizzlePersistence } from '@tanstack/ai-persistence-drizzle'
import { schema } from './db/tanstack-ai-schema'
import { db } from './db'

export const persistence = drizzlePersistence(db, {
  provider: 'sqlite',
  schema,
})
```

For local Node development without a kit journal yet, the `/sqlite` factory can
bootstrap stock tables at runtime (`ensureTables`, default `true`). That is not
a migration system — see [Drizzle](./drizzle).

## Cloudflare D1

D1 is SQLite. Use the same **schema-first Drizzle** workflow as above — this
package does **not** ship D1 SQL.

1. Re-export `@tanstack/ai-persistence-drizzle/sqlite-schema` or emit a starter
   with `tanstack-ai-drizzle-schema`.
2. Generate migrations with drizzle-kit (`dialect: 'sqlite'`).
3. Point Wrangler `d1_databases[].migrations_dir` at that journal and apply:

```bash
wrangler d1 migrations apply tanstack-ai-state --local
wrangler d1 migrations apply tanstack-ai-state --remote
```

Runtime: `cloudflarePersistence({ d1 })` (stock schema) or
`drizzlePersistence(drizzle(d1, { schema }), { provider: 'sqlite', schema })`
for a project-owned schema. See [Cloudflare](./cloudflare).

Durable Object **locks** do not use the D1 table journal — configure their
bindings and Durable Object migration tags in Wrangler separately.

## Prisma

Prisma ships a provider-neutral models fragment, then delegates SQL generation
to your application:

```bash
pnpm exec tanstack-ai-prisma-models --out prisma/schema
pnpm prisma migrate dev --name add-tanstack-ai-persistence
pnpm prisma generate
pnpm prisma migrate deploy
```

The copied fragment contains no datasource or generator. Keep those in your
application schema and commit the native migration Prisma creates for your
provider.

## Custom stores

Custom `AIPersistence` adapters own their schema and migrations entirely.
Maintain compatibility with the public store records and method semantics;
TanStack AI does not inspect your table layout.

## Upgrade discipline

1. Read the package release notes for schema contract changes.
2. Refresh emitted schema / models fragments in a reviewable branch.
3. Inspect the drizzle-kit or Prisma diff rather than forcing overwrites.
4. Back up production state where required.
5. Apply migrations before deploying code that depends on them.
6. Keep rollback and partial-deployment behavior explicit.
