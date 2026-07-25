---
name: ai-core/persistence/custom-stores
description: >
  Implement custom MessageStore, RunStore, InterruptStore, MetadataStore for
  @tanstack/ai-persistence. defineAIPersistence, composePersistence overrides,
  critical invariants (full-replace saveThread, insert-if-absent createOrResume
  and interrupt create), authorize thread access, runPersistenceConformance
  testkit. Use when infrastructure is not Drizzle/Prisma/D1 or selected stores
  must live in an app-owned database.
type: sub-skill
library: tanstack-ai
library_version: '0.10.0'
sources:
  - 'TanStack/ai:docs/persistence/custom-stores.md'
  - 'TanStack/ai:docs/persistence/controls.md'
  - 'TanStack/ai:packages/ai-persistence/src/types.ts'
---

# Custom Persistence Stores

> Builds on **ai-core/persistence** and **ai-core/persistence/server**.

Prefer packaged backends when they fit. Implement custom stores when:

- Your DB/ORM is not Drizzle/Prisma (or you already have tables),
- Only some keys (e.g. interrupts) must live in an app DB,
- You need multi-tenant columns, encryption, or outbox hooks inside the store.

## Choose a shape

```ts
import { defineAIPersistence } from '@tanstack/ai-persistence'
import type {
  MessageStore,
  RunStore,
  InterruptStore,
  MetadataStore,
} from '@tanstack/ai-persistence'

// Sparse is fine — only implement what you need
export const persistence = defineAIPersistence({
  stores: {
    messages, // required for withPersistence / reconstructChat
    runs, // required if you have interrupts
    interrupts,
    // metadata optional
  },
})
```

| Shape                      | Contents                                         |
| -------------------------- | ------------------------------------------------ |
| `ChatTranscriptStores`     | `messages` (+ optional runs/interrupts/metadata) |
| `ChatWithInterruptsStores` | `messages` + `runs` + `interrupts`               |
| `ChatPersistenceStores`    | all four (packaged backend shape)                |

`defineAIPersistence` preserves exact keys and rejects unknown keys at runtime.

## Contracts and invariants

### `MessageStore`

```ts
interface MessageStore {
  loadThread(threadId: string): Promise<Array<ModelMessage>>
  saveThread(threadId: string, messages: Array<ModelMessage>): Promise<void>
}
```

- `loadThread` → `[]` for unknown threads (never `null`).
- `saveThread` is a **full overwrite**, not append. A one-message payload wipes history.

### `RunStore`

```ts
interface RunStore {
  createOrResume(input: {
    runId: string
    threadId: string
    status?: RunStatus
    startedAt: number
  }): Promise<RunRecord>
  update(
    runId: string,
    patch: Partial<
      Pick<RunRecord, 'status' | 'finishedAt' | 'error' | 'usage'>
    >,
  ): Promise<void>
  get(runId: string): Promise<RunRecord | null>
  findActiveRun?(threadId: string): Promise<RunRecord | null> // optional
}
```

- **`createOrResume`**: if `runId` exists, return it **unchanged** (ignore new
  fields). Idempotent retries / resume depend on this.
- **`update`**: missing `runId` is a **no-op** (do not throw, do not insert).
- **`findActiveRun`**: latest `'running'` for `threadId` (max `startedAt`);
  enables reconnect without a client-held run id.

### `InterruptStore`

```ts
interface InterruptStore {
  create(record: Omit<InterruptRecord, 'status' | 'resolvedAt'>): Promise<void>
  resolve(interruptId: string, response?: unknown): Promise<void>
  cancel(interruptId: string): Promise<void>
  get(interruptId: string): Promise<InterruptRecord | null>
  list(threadId: string): Promise<Array<InterruptRecord>>
  listPending(threadId: string): Promise<Array<InterruptRecord>>
  listByRun(runId: string): Promise<Array<InterruptRecord>>
  listPendingByRun(runId: string): Promise<Array<InterruptRecord>>
}
```

- `create` always births `'pending'`; **insert-if-absent** on `interruptId`
  (never clobber resolved back to pending).
- All `list*` ordered by `requestedAt` ascending.
- Requires a `runs` store when used with chat persistence.

### `MetadataStore`

```ts
interface MetadataStore {
  get(scope: string, key: string): Promise<unknown | null>
  set(scope: string, key: string, value: unknown): Promise<void>
  delete(scope: string, key: string): Promise<void>
}
```

- Identity is **two fields** `(scope, key)` — do not join with `:` (collision).
- Stored `null` is type-indistinguishable from absence; wrap if you must
  persist real null (`{ value: null }`).
- SQL backends often reject nullish `set` (NOT NULL JSON columns) — match that
  or document your semantics.

## Minimal message store example

```ts
import type { MessageStore } from '@tanstack/ai-persistence'
import type { ModelMessage } from '@tanstack/ai'

const threads = new Map<string, Array<ModelMessage>>()

export const messages: MessageStore = {
  async loadThread(threadId) {
    return [...(threads.get(threadId) ?? [])]
  },
  async saveThread(threadId, next) {
    threads.set(threadId, [...next])
  },
}
```

For durable DBs, preserve the same semantics with upserts / full-row replace.

## Override a packaged backend

```ts
import { composePersistence } from '@tanstack/ai-persistence'
import { drizzlePersistence } from '@tanstack/ai-persistence-drizzle'
import { myInterrupts } from './my-interrupts'

export const persistence = composePersistence(base, {
  overrides: { interrupts: myInterrupts },
})
```

Only listed keys move; others stay on the base. No cross-store transaction.

## Authorization

Store methods take bare `threadId`s. **Authorize at the route** before
`loadThread` / `saveThread` / `reconstructChat({ authorize })`. Derive user
identity from session, not the client body alone.

## Conformance tests (required for custom backends)

```ts
import { runPersistenceConformance } from '@tanstack/ai-persistence/testkit'
import { myPersistence } from '../src/persistence'

runPersistenceConformance('my-backend', () => myPersistence())

// Intentional omissions:
// runPersistenceConformance('msgs-only', () => p, { skip: ['runs', 'interrupts', 'metadata'] })
```

The testkit is the compatibility gate: round-trips, empty-thread `[]`,
createOrResume idempotency, interrupt insert-if-absent, list ordering, etc.
A missing store that is not listed in `skip` fails loudly.

Reference implementation: `memoryPersistence()` in `@tanstack/ai-persistence`.

## Common mistakes

### CRITICAL: Append-only `saveThread`

Breaks the authoritative-history contract.

### CRITICAL: `createOrResume` overwriting existing runs

Breaks safe resume / double-submit.

### CRITICAL: Interrupt `create` upserting to pending

Can resurrect a resolved approval.

### HIGH: `list*` without stable `requestedAt` order

Middleware and tests assume ascending order.

### HIGH: Skipping testkit

Silent semantic drift shows up as stuck approvals or wiped history in prod.

## Cross-references

- **ai-core/persistence/backends** — use packaged first
- **ai-core/persistence/server** — when middleware calls each store
- **ai-core/persistence/locks** — not a state store
