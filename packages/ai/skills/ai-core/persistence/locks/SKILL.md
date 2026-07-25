---
name: ai-core/persistence/locks
description: >
  LockStore and withLocks for multi-instance coordination in TanStack AI.
  Separate from AIPersistence state stores. InMemoryLockStore vs Cloudflare
  Durable Object locks, lease recovery, AbortSignal in critical sections.
  Use when sandbox or other middleware needs cross-worker mutual exclusion —
  NOT for storing messages/runs (use withPersistence).
type: sub-skill
library: tanstack-ai
library_version: '0.10.0'
sources:
  - 'TanStack/ai:docs/persistence/controls.md'
  - 'TanStack/ai:docs/persistence/cloudflare.md'
---

# Persistence Locks

> Builds on **ai-core/persistence**. Locks are **not** part of
> `AIPersistence.stores` and are **not** composed with
> `composePersistence`.

## Why separate?

State stores answer “what is durable chat data?”  
Locks answer “who may run this critical section right now?”

`withPersistence` does **not** automatically lock a whole turn. Take a
per-thread (or other) lock yourself when multi-writer races matter.

## Wire locks

```ts
import {
  withPersistence,
  withLocks,
  InMemoryLockStore,
} from '@tanstack/ai-persistence'
import { createDurableObjectLockStore } from '@tanstack/ai-persistence-cloudflare'

middleware: [
  withPersistence(persistence),
  withLocks(new InMemoryLockStore()), // single process
  // withLocks(createDurableObjectLockStore(env.AI_LOCKS)), // multi-instance
]
```

`withLocks` provides `LocksCapability` for downstream middleware (e.g.
sandbox). Order: usually state first, locks alongside or after depending on
who consumes the capability.

## Implementations

| Store                              | Package                               | Use when                     |
| ---------------------------------- | ------------------------------------- | ---------------------------- |
| `InMemoryLockStore`                | `@tanstack/ai-persistence`            | Single process, tests, local |
| `createDurableObjectLockStore(ns)` | `@tanstack/ai-persistence-cloudflare` | Multiple Workers / instances |

### Cloudflare Durable Objects

```ts
import { createDurableObjectLockStore } from '@tanstack/ai-persistence-cloudflare'

export { CloudflareLockDurableObject } from '@tanstack/ai-persistence-cloudflare'

const locks = createDurableObjectLockStore(env.AI_LOCKS, {
  leaseDurationMs: 30_000,
  retryDelayMs: 50,
})
```

Configure DO bindings and Wrangler migration tags for the lock class. This is
unrelated to D1 schema migrations for chat tables.

## Lease semantics

A good `LockStore`:

- Serializes owners per key,
- Uses **leases** (or equivalent) so a crashed owner cannot block forever,
- Passes an `AbortSignal` into the critical section via `withLock`; when the
  lease is lost, abort so work stops starting external mutations.

Callbacks must honor the signal and pass it to cancellable dependencies.

## Common mistakes

### HIGH: Putting locks on `AIPersistence.stores`

Not supported. Use `withLocks`.

### HIGH: `InMemoryLockStore` across multiple processes

No mutual exclusion between machines — use DO locks or another distributed
backend.

### MEDIUM: Ignoring lease abort

Continuing work after losing the lease races other owners.

## Cross-references

- **ai-core/persistence/server** — state middleware
- **ai-core/persistence/backends** — D1 + DO package split
