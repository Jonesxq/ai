---
name: tanstack-ai-persistence-build-prisma-adapter
description: Use when building a Prisma persistence backend on the @tanstack/ai-persistence core — covers the provider-neutral models fragment, reading model delegates off the client, BigInt timestamp conversion, JSON-as-string columns, upsert idempotency, and model renaming.
---

# Build a Prisma Persistence Adapter

You want TanStack AI chat state in whatever database your Prisma schema targets
(Postgres, MySQL, SQLite, ...). Prisma is provider-neutral, so this adapter ships
a models fragment and reads delegates off the client the app already generated
and migrated. It builds on the `@tanstack/ai-persistence` core.

Read the **Build Your Own Adapter** guide
(`docs/persistence/build-your-own-adapter.md`) first for the store contracts and
invariants. This is the Prisma-specific recipe.

## Package shape

Peer dep: `@prisma/client >=6.7.0`. The adapter provides `messages`, `runs`,
`interrupts`, `metadata` — the only four keys `stores` accepts. It does not ship
a datasource, generator, connection URL, or prebuilt SQL migration: those stay
in the app's schema. Annotate the factory's return as `ChatPersistence`; bare
`AIPersistence` is the all-optional bag and `withPersistence` rejects it.

Support Prisma 6 and 7 by typing the client argument **structurally** (a
`PrismaClientLike` shape) and reading model delegates off it at runtime. The
delegate query API (`findUnique`, `upsert`, `update`, `findMany`, `delete`) is
the same across versions, so it does not matter where the client was imported
from.

## Models fragment

Ship a provider-neutral `tanstack-ai.prisma` fragment with `@map`/`@@map` for
database names. IDs are `String`, timestamps are `BigInt` (portable epoch ms),
JSON payloads are `String`.

```prisma
model Message {
  threadId     String @id @map("thread_id")
  messagesJson String @map("messages_json")
  @@map("messages")
}

model Run {
  runId      String  @id @map("run_id")
  threadId   String  @map("thread_id")
  status     String
  startedAt  BigInt  @map("started_at")
  finishedAt BigInt? @map("finished_at")
  error      String?
  usageJson  String? @map("usage_json")
  @@map("runs")
}

model Interrupt {
  interruptId  String  @id @map("interrupt_id")
  runId        String  @map("run_id")
  threadId     String  @map("thread_id")
  status       String
  requestedAt  BigInt  @map("requested_at")
  resolvedAt   BigInt? @map("resolved_at")
  payloadJson  String  @map("payload_json")
  responseJson String? @map("response_json")
  @@map("interrupts")
}

model Metadata {
  scope     String
  key       String
  valueJson String @map("value_json")
  @@id([scope, key])
  @@map("metadata")
}
```

Ship it as a raw string asset plus a CLI (`tanstack-ai-prisma-models`) that
copies it into the app's multi-file schema directory. The app then runs
`prisma migrate dev` / `prisma migrate deploy` to generate provider-native SQL.

## Two conversions the SQL backends do not need

Prisma has no JSON column mode here and returns `BigInt` for the timestamp
columns, so the row mappers do more than the Drizzle backend:

- **Timestamps**: store `Number → BigInt` on write, read `Number(row.startedAt)`
  back. The record fields are plain `number` (epoch ms).
- **JSON**: `JSON.stringify` on write, `JSON.parse` on read for
  `messagesJson`, `usageJson`, `payloadJson`, `responseJson`, `valueJson`.

## Stores: idempotency via upsert-with-empty-update

Same invariants as every backend, expressed in Prisma:

- **messages**: `upsert({ where: { threadId }, create, update })`.
- **runs.createOrResume**: `upsert` with an **empty `update: {}`** so an existing
  run is returned unchanged (the Prisma equivalent of `ON CONFLICT DO NOTHING`).
  `update` patches only provided fields; an unknown id is a no-op.
- **interrupts.create**: `upsert({ where: { interruptId }, create, update: {} })`
  — insert-if-absent, never clobber a resolved interrupt. `resolve`/`cancel`
  stamp `resolvedAt`. Every `list*` uses `orderBy: { requestedAt: 'asc' }`.
- **metadata**: reject nullish with a clear `TypeError`; `(scope, key)` is the
  composite id via the `scope_key` unique alias.

## Rename the models

The fragment's names are generic and an app often already has a `Message` or
`Run` model. Let consumers rename freely and map each store to the renamed client
delegate:

```ts ignore
prismaPersistence(prisma, { models: { messages: 'chatMessage' } })
```

Map values are the **camelCase** client accessors (`prisma.chatMessage`), not the
PascalCase model names. Throw a `PrismaModelError` naming every store whose
delegate cannot be found. Keep the field surface and the `scope_key` alias fixed;
database names and extra app-owned fields (keep them optional/defaulted) are the
consumer's.

## Verify

Run `runPersistenceConformance` from `@tanstack/ai-persistence/testkit` over a
temporary SQLite database generated from the fragment. All four state stores
are provided, so pass no `skip` — and note that `skip` only ever accepts
`'messages' | 'runs' | 'interrupts' | 'metadata'`. Locks are not a state store
and the suite does not cover them.
