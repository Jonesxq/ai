---
title: Sandbox Persistence
id: sandbox-persistence
order: 9
description: "Make sandbox resume durable across processes and instances with a SandboxStore and a shared lock."
---

Your agent runs behind more than one server instance, or at the edge. A run
spins up a sandbox, clones the repo, installs deps, does its work. The next run
for the same thread should pick that sandbox back up. Instead it builds a fresh
one every time and pays the whole cold-start cost again.

[Lifecycle & Snapshots](./lifecycle) already knows how to resume, but its
bookkeeping is in-memory, so it only holds within one process. The moment a run
lands on a different replica (or a fresh isolate), that instance has never seen
the sandbox and re-creates it.

Sandbox persistence makes resume durable across instances. Two pieces:

- **`SandboxStore`**: the record of which provider sandbox (and snapshot) to
  resume for a given key. Durable, shared across instances. When present on a
  `withPersistence` bag, the shared `sandbox-store` capability is provided for
  `withSandbox`.
- **`LockStore`**: mutual exclusion around resume-or-create, so two runs for the
  same thread don't both create a sandbox. Provided separately with
  `withLocks`. Across instances this has to be a distributed lock.

Both capability tokens live in core `@tanstack/ai` so persistence and sandbox
share the same references — no package-to-package dependency.

## Wire it up

Node / single process. `memoryPersistence()` includes an in-memory sandbox store; swap in your own adapter for anything durable (see [Build your own adapter](../persistence/build-your-own-adapter)).

```ts
import { chat } from '@tanstack/ai'
import { grokBuildText } from '@tanstack/ai-grok-build'
import { withSandbox } from '@tanstack/ai-sandbox'
import {
  InMemoryLockStore,
  memoryPersistence,
  withLocks,
  withPersistence,
} from '@tanstack/ai-persistence'
import { sandbox } from './sandbox'
import { messages } from './chat-context'

const persistence = memoryPersistence()

chat({
  adapter: grokBuildText('grok-build'),
  messages,
  middleware: [
    withPersistence(persistence),
    withLocks(new InMemoryLockStore()),
    withSandbox(sandbox),
  ],
})
```

With `reuse: 'thread'` (the default), the first run creates and records the
sandbox. A later run for the same `threadId` resumes it, even on a different
instance (when the store and lock are distributed).

## Custom store

Implement `SandboxStore` and pass it on the persistence bag:

```ts
import type { SandboxRecord, SandboxStore } from '@tanstack/ai'

// Swap the Map for your database. `get` returns null when the key is unknown,
// and `upsert` overwrites by `record.key` — the same insert-or-replace shape
// the chat stores use.
const records = new Map<string, SandboxRecord>()

export const sandboxStore: SandboxStore = {
  async get(key) {
    return records.get(key) ?? null
  },
  async upsert(record) {
    records.set(record.key, record)
  },
  async delete(key) {
    records.delete(key)
  },
}
```

Pair it with a distributed `LockStore` via `withLocks` in multi-instance
deployments. The in-memory lock is only correct within one process.

## See also

- [Persistence overview](../persistence/overview)
- [Controls](../persistence/controls)
- [Build your own adapter](../persistence/build-your-own-adapter)
- [Sandbox lifecycle](./lifecycle)
