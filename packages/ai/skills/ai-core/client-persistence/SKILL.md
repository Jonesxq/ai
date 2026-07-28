---
name: ai-core/client-persistence
description: >
  Browser chat persistence on useChat / ChatClient: localStoragePersistence,
  sessionStoragePersistence, indexedDBPersistence. Client-authoritative
  (adapter, full transcript) vs server-authoritative (persistence: true, no
  client cache).
  Reload restore, pending interrupts, mid-stream rejoin with delivery
  durability. Use for SPA reload durability — NOT server history alone.
  Also covers generation hooks (useGenerateImage etc.), same two modes as chat:
  client-driven (adapter) persists a lightweight resume snapshot under
  generation:<id>; server-driven (persistence: true + threadId) hydrates the last
  generation from the server on mount, nothing cached.
  No extra package: the adapters ship in the framework packages.
type: sub-skill
library: tanstack-ai
library_version: '0.10.0'
sources:
  - 'TanStack/ai:docs/persistence/client-persistence.md'
  - 'TanStack/ai:docs/persistence/overview.md'
---

# Client Persistence

> Builds on ai-core, and on `ai-core/chat-experience` for `useChat` itself.
>
> **No extra package.** The adapters below ship in the **framework** packages
> (`@tanstack/ai-react` and friends, re-exported from `@tanstack/ai-client`),
> so browser persistence needs nothing installed beyond what a chat UI already
> has. The **server** half is a separate package — see
> `@tanstack/ai-persistence` and its `ai-persistence/server` skill.

A `ChatClient` / `useChat` keeps messages in memory. The `persistence` option
stores one record per `threadId` so a reload can repaint the transcript,
restore a pending interrupt, and rejoin an in-flight run.

Import adapters from the **framework package** (not `@tanstack/ai-client`
unless vanilla JS):

```tsx
import {
  useChat,
  fetchServerSentEvents,
  localStoragePersistence,
  sessionStoragePersistence,
  indexedDBPersistence,
} from '@tanstack/ai-react'
```

## Adapters

| Adapter                       | Survives                   | Notes                                                           |
| ----------------------------- | -------------------------- | --------------------------------------------------------------- |
| `localStoragePersistence()`   | Reloads + browser restarts | Sync hydrate; quota-bound; JSON codec default                   |
| `sessionStoragePersistence()` | Reloads in the same tab    | Cleared when tab/session ends                                   |
| `indexedDBPersistence()`      | Reloads + restarts         | Async open (first paint may be empty briefly); structured clone |

All default to the chat persisted-state shape — no type argument or codec
required for normal use.

## Mode A — cache everything (client-authoritative)

```tsx
function Chat() {
  const { messages, sendMessage } = useChat({
    threadId: 'support-chat', // stable — required
    connection: fetchServerSentEvents('/api/chat'),
    persistence: localStoragePersistence(),
  })
  // ...
}
```

Bare adapter ≡ full transcript + resume pointer. Browser owns history; server
(if any) mirrors when you post non-empty `messages`.

Best for: SPA, offline-first, single device, moderate conversation size.

## Mode B — server-authoritative (`persistence: true`)

```tsx
function Chat({ threadId }: { threadId: string }) {
  const { messages, sendMessage } = useChat({
    threadId,
    connection: fetchServerSentEvents('/api/chat'),
    persistence: true,
  })
  // ...
}
```

Nothing is cached client-side: no transcript, no resume pointer.

On mount, `useChat` hydrates the thread from the **server** by `threadId`
(paint + tail active run). Same path for another device. Pair with server
`withPersistence` + a hydrate route (`reconstructChat` or equivalent).

Best for: large transcripts, multi-device, compliance (no message bodies in
browser storage).

## What a reload restores

1. **Finished run** — transcript from the adapter (mode A) or server (mode B).
2. **Paused on interrupt** — approval UI restored (from the adapter in mode A,
   the server hydrate in mode B).
3. **Still streaming** — needs **delivery durability** on the route
   (`toServerSentEventsResponse(stream, { durability: … })`) so the client can
   `joinRun` and finish the reply. Persistence alone is not enough.

## Stable `threadId` is the identity

Persistence keys on `threadId`. The hooks have **no separate `id` option** — a
chat's identity _is_ its `threadId`. Without a stable one, each load is a new
chat. Generate it server-side or from a route param the user owns; do not
randomize per mount.

## Generation hooks: two modes, mirroring chat

The generation hooks (`useGenerateImage`, `useGenerateVideo`, `useGeneration`,
`useSummarize`, `useTranscription`, …) take the **same `persistence` option** as
`useChat` — `boolean | adapter` — with the same two-mode split. Whichever mode,
what persists is a `GenerationResumeSnapshot`: run identity, status, error, and
result metadata (ids, model, video `jobId`), **never the generated media bytes**.

### Mode A — client-driven (a storage adapter)

```tsx
const image = useGenerateImage({
  id: 'hero-image', // stable — the storage key is `generation:<id>`
  connection: fetchServerSentEvents('/api/generate/image'),
  persistence: localStoragePersistence(),
})
// After a reload: image.resumeSnapshot?.status is the last run's outcome.
// image.resumeState is non-null only WHILE a run is streaming.
```

- The lightweight snapshot is cached in the browser under `generation:<id>` as a
  run streams, and read back on mount.
- Hydration is automatic on mount and validated
  (`parseGenerationResumeSnapshot`); an explicit `initialResumeSnapshot` seed
  skips it.
- The `generation:` key segment means a chat and a generation client can share
  an id and an adapter without colliding.

### Mode B — server-driven (`persistence: true`)

```tsx
const image = useGenerateImage({
  threadId, // stable — the key the last generation is hydrated under (falls back to id)
  connection: fetchServerSentEvents('/api/generate/image'),
  persistence: true,
})
// After a reload: image.resumeSnapshot is the last generation for `threadId`,
// fetched from the server — nothing was cached in the browser.
```

- Nothing is cached client-side. On mount the client hydrates the **last
  generation** for its `threadId` from the server via the connection's
  `hydrateGeneration` handler (the SSE/HTTP adapters issue a `GET` with
  `?threadId=` to the same endpoint URL) and repaints that snapshot.
- The server `GET` returns `reconstructGeneration(persistence, request)` from
  `@tanstack/ai-persistence` — it resolves the job by `?jobId=` (preferred) or
  the latest job linked to `?threadId=`, and needs `stores.jobs`. Pair it with
  `withGenerationPersistence` on the generation route. See
  `ai-core/media-generation` and `ai-persistence`.
- Best for multi-device / compliance (no generation metadata in browser
  storage), exactly like chat Mode B.

Common to both modes:

- `stop()` marks the record no longer resumable; `reset()` deletes it (Mode A) or
  clears the in-memory snapshot (Mode B).
- Nothing auto-runs from a hydrated snapshot — `generate(...)` is always
  explicit.

## Common mistakes

### HIGH: No `threadId`

Record cannot be found after reload.

### HIGH: Passing `id` to `useChat`

Removed — `threadId` is the identity. (`ChatClient` still accepts `id` directly
as a lower-level escape hatch for keying storage separately from the wire
thread; the framework hooks do not.)

### HIGH: `persistence: true` without server history

Empty chat after reload unless the server can reconstruct by `threadId`.

### MEDIUM: Huge transcripts in `localStorage`

Quota and main-thread cost. Prefer `persistence: true` + server store, or
IndexedDB with care.

### MEDIUM: Expecting multi-device sync from client storage alone

`localStorage` is per-browser. Use server persistence for multi-device.

## Cross-references

- **ai-persistence/server** (`@tanstack/ai-persistence`) — authoritative server half
- **ai-core/chat-experience** — `useChat`, resumable connections
- Resumable streams docs — mid-stream rejoin
