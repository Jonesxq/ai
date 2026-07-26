---
name: tanstack-ai-persistence-locks
description: >
  LockStore and withLocks for multi-instance coordination in TanStack AI.
  Separate from AIPersistence state stores — not a stores key, not composable.
  InMemoryLockStore vs a distributed (e.g. Cloudflare Durable Object) lock,
  lease recovery, AbortSignal in critical sections. Use when sandbox or other
  middleware needs cross-worker mutual exclusion — NOT for storing
  messages/runs (use withPersistence).
type: sub-skill
library: tanstack-ai-persistence
library_version: '0.0.0'
sources:
  - 'TanStack/ai:docs/persistence/controls.md'
  - 'TanStack/ai:packages/ai-persistence/src/locks.ts'
---

# Persistence Locks

> Builds on **tanstack-ai-persistence**. Locks are **not** part of
> `AIPersistence.stores` and are **not** composed with `composePersistence`.

## Why separate?

State stores answer "what is durable chat data?"  
Locks answer "who may run this critical section right now?"

`withPersistence` does **not** automatically lock a whole turn. Take a
per-thread (or other) lock yourself when multi-writer races matter.

## Wire locks

```ts
import {
  withPersistence,
  withLocks,
  InMemoryLockStore,
} from '@tanstack/ai-persistence'

middleware: [
  withPersistence(persistence),
  withLocks(new InMemoryLockStore()), // single process
]
```

`withLocks` provides `LocksCapability` for downstream middleware (e.g.
sandbox). Order: usually state first, locks alongside or after depending on
who consumes the capability.

## The contract

```ts
interface LockStore {
  withLock<T>(key: string, fn: (signal: AbortSignal) => Promise<T>): Promise<T>
}
```

`InMemoryLockStore` ships in `@tanstack/ai-persistence`: a per-key promise
chain, correct **within a single process only**. Multi-instance deployments
need a distributed implementation — you write it, the same way you write a
state adapter. The Cloudflare Durable Object recipe is in
**tanstack-ai-persistence-build-cloudflare-adapter**.

## Lease semantics

A good `LockStore`:

- Serializes owners per key,
- Uses **leases** (or equivalent) so a crashed owner cannot block forever,
- Passes an `AbortSignal` into the critical section via `withLock`; when the
  lease is lost, abort so work stops starting external mutations.

Callbacks must honor the signal and pass it to cancellable dependencies.
`InMemoryLockStore` never aborts its signal — within one process, ownership
cannot be lost.

## Capability identity

The `'locks'` capability token is defined **locally** in
`@tanstack/ai-persistence`. Capability identity is by object reference, not by
name, so it does not interoperate with the identically-named capability owned
by `@tanstack/ai-sandbox`.

## Common mistakes

### HIGH: Putting `locks` on `AIPersistence.stores`

Not supported. `stores` accepts only `messages`, `runs`, `interrupts`,
`metadata` and throws `Unknown AIPersistence store key: locks`. Use
`withLocks`.

### HIGH: Passing `locks` to `composePersistence` overrides

Same rejection, at the override layer. Locks are not state.

### HIGH: Passing `'locks'` to the conformance testkit's `skip`

`skip` accepts only the four state store keys. The suite does not cover locks
at all, so there is nothing to skip — test lease expiry and abort separately.

### HIGH: `InMemoryLockStore` across multiple processes

No mutual exclusion between machines — use a distributed lock store.

### MEDIUM: Ignoring lease abort

Continuing work after losing the lease races other owners.

## Cross-references

- **tanstack-ai-persistence-server** — state middleware
- **tanstack-ai-persistence-build-cloudflare-adapter** — Durable Object lock recipe
