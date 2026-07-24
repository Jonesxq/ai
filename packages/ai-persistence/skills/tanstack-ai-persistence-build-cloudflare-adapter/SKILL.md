---
name: tanstack-ai-persistence-build-cloudflare-adapter
description: Use when building a Cloudflare persistence backend on the @tanstack/ai-persistence core — covers mapping the state stores to D1 (via a Drizzle SQLite backend) and a distributed locks store to a Durable Object, wrangler bindings, and D1 migration parity.
---

# Build a Cloudflare Persistence Adapter

You want TanStack AI chat state on Cloudflare-native primitives: the structured
stores in D1, and a distributed `locks` store in a Durable Object. This is the
one backend that provides `locks`, because a Worker runs on many isolates and
needs real cross-worker coordination. It builds on the `@tanstack/ai-persistence`
core.

Read the **Build Your Own Adapter** guide
(`docs/persistence/build-your-own-adapter.md`) for the store contracts, and the
Drizzle adapter skill, since D1 reuses a Drizzle SQLite backend. This skill covers
only the Cloudflare-specific parts.

## Binding map

```
D1 database      -> messages, runs, interrupts, metadata
Durable Object   -> locks
```

Pass only the bindings you have. The return type contains exactly the stores
those bindings can provide, so a D1-only adapter is valid and simply has no
`locks`.

Peer deps: `@cloudflare/workers-types >=4.x`, `drizzle-orm >=0.44.0`. In the build
config, prepend a `/// <reference types="@cloudflare/workers-types" />` to the
generated `index.d.ts` so consumers get the D1/DurableObject types.

## D1 stores: compose a Drizzle backend

D1 speaks SQLite, so do not re-implement the four stores. Wrap the D1 binding in
Drizzle and hand it to the Drizzle SQLite backend:

```ts ignore
import { drizzle } from 'drizzle-orm/d1'
import { drizzlePersistence, schema } from '@tanstack/ai-persistence-drizzle'

export function createD1Stores(d1: D1Database) {
  return drizzlePersistence(drizzle(d1, { schema }))
}
```

The D1 migration SQL must be **byte-identical** to the Drizzle backend's asset.
Ship it plus a CLI (`tanstack-ai-cloudflare-migrations`) and guard the parity with
a test, so the two never drift.

## Durable Object lock store

Implement `LockStore` from `@tanstack/ai-persistence`. `withLock(key, fn)` routes
each key to a Durable Object instance (via `idFromName(key)`) that serializes
owners. Use **leases** so a crashed owner cannot block forever: the DO grants a
lease with an expiry, an alarm reclaims it, and the lock passes the callback an
`AbortSignal` that fires when ownership can no longer be guaranteed. Callbacks
must stop starting external mutations once the signal aborts.

```ts ignore
import { composePersistence } from '@tanstack/ai-persistence'

export function cloudflarePersistence(options: {
  d1: D1Database
  durableObjects?: DurableObjectNamespace
  lockOptions?: { leaseDurationMs: number; retryDelayMs: number }
}) {
  const base = createD1Stores(options.d1)
  if (!options.durableObjects) return base
  return composePersistence(base, {
    overrides: {
      locks: createDurableObjectLockStore(options.durableObjects, options.lockOptions),
    },
  })
}
```

Re-export the DO class from the Worker entry so wrangler can bind it:

```ts ignore
export { CloudflareLockDurableObject } from '@tanstack/ai-persistence-cloudflare'
```

## wrangler bindings

```jsonc
{
  "d1_databases": [
    { "binding": "AI_STATE", "database_name": "tanstack-ai-state", "database_id": "<id>", "migrations_dir": "migrations" }
  ],
  "durable_objects": {
    "bindings": [{ "name": "AI_LOCKS", "class_name": "CloudflareLockDurableObject" }]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["CloudflareLockDurableObject"] }
  ]
}
```

Apply D1 table migrations with `wrangler d1 migrations apply tanstack-ai-state`
(`--local` then `--remote`). Durable Object locks do not use the D1 table
migration set; their state is configured through the migration tags above.

## Verify

Run `runPersistenceConformance` from `@tanstack/ai-persistence/testkit` against a
Miniflare D1 binding. Include `locks` in the run (do not skip it) since this
backend provides it, and add a separate test for lease expiry and abort.
