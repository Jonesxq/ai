---
title: Cloudflare Persistence
id: cloudflare
---

# Cloudflare Persistence

`@tanstack/ai-persistence-cloudflare` maps TanStack AI to Cloudflare-native
primitives. **State** and **locks** are separate:

| Binding | What it provides | How you wire it |
| --- | --- | --- |
| D1 | State stores: `messages`, `runs`, `interrupts`, `metadata` | `cloudflarePersistence({ d1 })` + `withPersistence` |
| Durable Objects | Distributed `LockStore` | `createDurableObjectLockStore` + `withLocks` |

This package persists state (and optionally provides locks). It does not provide
a stream-delivery adapter; stream re-attach / delivery durability is a separate
transport-layer feature ([Resumable Streams](../resumable-streams/overview)).

## Configure bindings

```jsonc
// wrangler.jsonc
{
  "d1_databases": [
    {
      "binding": "AI_STATE",
      "database_name": "tanstack-ai-state",
      "database_id": "<database-id>",
      "migrations_dir": "migrations"
    }
  ],
  "durable_objects": {
    "bindings": [
      {
        "name": "AI_LOCKS",
        "class_name": "CloudflareLockDurableObject"
      }
    ]
  },
  "migrations": [
    {
      "tag": "v1",
      "new_sqlite_classes": ["CloudflareLockDurableObject"]
    }
  ]
}
```

Re-export the lock Durable Object from your Worker entry when you use locks:

```ts
export { CloudflareLockDurableObject } from '@tanstack/ai-persistence-cloudflare'
```

## Create state persistence (D1)

```ts ignore
import { cloudflarePersistence } from '@tanstack/ai-persistence-cloudflare'

interface Env {
  AI_STATE: D1Database
}

export function createPersistence(env: Env) {
  return cloudflarePersistence({ d1: env.AI_STATE })
}
```

D1 stores structured records in SQLite tables. Apply this package's D1
migrations before use — see [Migrations](./migrations).

## Optional: Durable Object locks

Locks are **not** part of the state bag. Create a `LockStore` and pass it to
`withLocks`:

```ts ignore
import { createDurableObjectLockStore } from '@tanstack/ai-persistence-cloudflare'

interface Env {
  AI_LOCKS: DurableObjectNamespace
}

export function createLocks(env: Env) {
  return createDurableObjectLockStore(env.AI_LOCKS, {
    leaseDurationMs: 30_000,
    retryDelayMs: 50,
  })
}
```

Each lock key is routed to a Durable Object, which serializes owners and uses
leases/alarms for recovery.

## Use it with chat

```ts ignore
import {
  chat,
  chatParamsFromRequest,
  toServerSentEventsResponse,
} from '@tanstack/ai'
import { openaiText } from '@tanstack/ai-openai'
import { withPersistence, withLocks } from '@tanstack/ai-persistence'
import { createDurableObjectLockStore } from '@tanstack/ai-persistence-cloudflare'
import { createPersistence } from './persistence'

interface Env {
  AI_STATE: D1Database
  AI_LOCKS: DurableObjectNamespace
}

export default {
  async fetch(request: Request, env: Env) {
    try {
      const params = await chatParamsFromRequest(request)
      const persistence = createPersistence(env)
      const stream = chat({
        adapter: openaiText('gpt-5.5'),
        messages: params.messages,
        threadId: params.threadId,
        runId: params.runId,
        ...(params.resume ? { resume: params.resume } : {}),
        middleware: [
          withPersistence(persistence),
          // Only if other middleware needs multi-instance coordination:
          withLocks(createDurableObjectLockStore(env.AI_LOCKS)),
        ],
      })

      return toServerSentEventsResponse(stream)
    } catch (error) {
      if (error instanceof Response) return error
      throw error
    }
  },
}
```

State-only setups omit `withLocks` and the DO binding entirely.

## Apply D1 migrations

The package exports an ordered `d1Migrations` manifest and a CLI. Copy the SQL
into the directory managed by Wrangler:

```bash
pnpm exec tanstack-ai-cloudflare-migrations --out migrations
wrangler d1 migrations apply tanstack-ai-state --local
wrangler d1 migrations apply tanstack-ai-state --remote
```

Use `--stdout` to print the ordered SQL. Existing divergent files are not
overwritten unless `--force` is passed. Commit the copied migrations and apply
them before deploying code that uses the stores.

Programmatic tooling can read the same manifest:

```ts
import { d1Migrations } from '@tanstack/ai-persistence-cloudflare'

for (const migration of d1Migrations) {
  console.log(migration.filename)
}
```

## Override selected stores

Use Cloudflare D1 as the base and replace only application-owned stores:

```ts ignore
import { composePersistence } from '@tanstack/ai-persistence'
import { createPersistence } from './persistence'
import { customInterrupts, customRuns } from './stores'

interface Env {
  AI_STATE: D1Database
}

export function createComposedPersistence(env: Env) {
  return composePersistence(createPersistence(env), {
    overrides: {
      interrupts: customInterrupts,
      runs: customRuns,
    },
  })
}
```

D1 continues to own messages and metadata. Locks stay on `withLocks` if you
need them. Cross-backend transactions are not added by composition; design
retries and consistency explicitly.
