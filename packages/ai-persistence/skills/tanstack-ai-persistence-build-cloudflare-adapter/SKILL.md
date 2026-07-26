---
name: tanstack-ai-persistence-build-cloudflare-adapter
description: Use when building a Cloudflare persistence backend on the @tanstack/ai-persistence core — covers mapping the four state stores to D1, a distributed LockStore on a Durable Object with leases and AbortSignal, wrangler bindings, and D1 schema ownership.
---

# Build a Cloudflare Persistence Adapter

You want TanStack AI chat state on Cloudflare-native primitives: the four state
stores in D1, and a distributed lock on a Durable Object. Cloudflare is the
case that most needs a real lock, because a Worker runs on many isolates and
`InMemoryLockStore` gives no mutual exclusion across them.

Read the **Build Your Own Adapter** guide
(`docs/persistence/build-your-own-adapter.md`) for the store contracts, and
**tanstack-ai-persistence-stores** for the shape rules. This skill covers only
the Cloudflare-specific parts.

## Two independent pieces

```
D1 database      -> messages, runs, interrupts, metadata   (AIPersistence.stores)
Durable Object   -> LockStore                              (withLocks — NOT a store)
```

These do not compose into one object. `AIPersistence.stores` accepts exactly
four keys; putting `locks` in the map — or in a `composePersistence` override —
throws `Unknown AIPersistence store key: locks` and fails to type-check. Return
the state persistence from one factory and the lock store from another, then
wire them as two middlewares.

Peer deps: `@cloudflare/workers-types >=4.x`. In the build config, prepend a
`/// <reference types="@cloudflare/workers-types" />` to the generated
`index.d.ts` so consumers get the D1/DurableObject types.

## D1 stores

D1 speaks SQLite. Two routes:

- **Raw D1** — implement the four stores directly against
  `d1.prepare(sql).bind(...)`. `.first()` for `get`, `.all()` for `list*`,
  `.run()` for writes. This is the dependency-free option and mirrors the
  `node:sqlite` walkthrough in the guide one-for-one; only the driver calls
  change (everything is async, so no `Promise.resolve` wrapping).
- **Drizzle over D1** — if you already run Drizzle, wrap the binding with
  `drizzle(d1, { schema })` and reuse the SQLite recipe from
  **tanstack-ai-persistence-build-drizzle-adapter** verbatim.

Either way the invariants are the ones that matter: `saveThread` full replace,
`createOrResume` read-then-`INSERT ... ON CONFLICT DO NOTHING`, interrupt
`create` insert-if-absent, every `list*` `ORDER BY requested_at ASC`.

```ts ignore
import { defineAIPersistence } from '@tanstack/ai-persistence'
import type { ChatPersistence } from '@tanstack/ai-persistence'

export function d1Persistence(d1: D1Database): ChatPersistence {
  return defineAIPersistence({
    stores: {
      messages: createMessageStore(d1),
      runs: createRunStore(d1),
      interrupts: createInterruptStore(d1),
      metadata: createMetadataStore(d1),
    },
  })
}
```

## Schema ownership

Do not ship a migration runner. Emit the D1 table SQL into the consumer's
`migrations/` directory and let `wrangler d1 migrations apply` own it — Wrangler
already tracks applied migrations, so a second bookkeeping table only creates
drift. If you also offer a Drizzle path, the SQL you emit and the schema the
Drizzle tables describe must agree; guard that with a test.

## Durable Object lock store

Implement `LockStore` from `@tanstack/ai-persistence`:

```ts ignore
import type { LockStore } from '@tanstack/ai-persistence'
```

`withLock(key, fn)` routes each key to a Durable Object instance (via
`idFromName(key)`) that serializes owners. Use **leases** so a crashed owner
cannot block forever: the DO grants a lease with an expiry, an alarm reclaims
it, and the lock passes the callback an `AbortSignal` that fires when ownership
can no longer be guaranteed. Callbacks must stop starting external mutations
once the signal aborts.

Export the DO class from the Worker entry so wrangler can bind it:

```ts ignore
export { ChatLockDurableObject } from './locks'
```

## Wire both

```ts ignore
import { withPersistence, withLocks } from '@tanstack/ai-persistence'

const middleware = [
  withPersistence(d1Persistence(env.AI_STATE)),
  withLocks(createDurableObjectLockStore(env.AI_LOCKS)),
]
```

## wrangler bindings

```jsonc
{
  "d1_databases": [
    {
      "binding": "AI_STATE",
      "database_name": "tanstack-ai-state",
      "database_id": "<id>",
      "migrations_dir": "migrations",
    },
  ],
  "durable_objects": {
    "bindings": [{ "name": "AI_LOCKS", "class_name": "ChatLockDurableObject" }],
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["ChatLockDurableObject"] },
  ],
}
```

Apply D1 table migrations with `wrangler d1 migrations apply tanstack-ai-state`
(`--local` then `--remote`). Durable Object locks do not use the D1 table
migration set; their state is configured through the migration tags above.

## Verify

Run `runPersistenceConformance` from `@tanstack/ai-persistence/testkit` against
a Miniflare D1 binding. All four state stores are provided, so pass no `skip` —
and `skip` never accepts `'locks'`: the suite covers state only.

The lock store needs its **own** tests, because nothing in the conformance
suite touches it. Cover at minimum: two concurrent `withLock` calls on the same
key serialize; different keys do not block each other; a lease that expires
aborts the signal handed to the critical section; and a callback that throws
still releases the lock.
