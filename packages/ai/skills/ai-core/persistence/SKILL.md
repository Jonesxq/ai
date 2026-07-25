---
name: ai-core/persistence
description: >
  Durability and state persistence for TanStack AI chats. Routes to server chat
  persistence (withPersistence), client persistence (localStorage/IndexedDB),
  packaged backends (Drizzle/Prisma/Cloudflare), custom stores, and locks.
  Distinguishes delivery durability (resumable streams) from conversation
  state. Use when conversations must survive reloads, multi-device, approvals,
  or server restarts — NOT for stream reconnect alone (resumable streams).
type: sub-skill
library: tanstack-ai
library_version: '0.10.0'
sources:
  - 'TanStack/ai:docs/persistence/overview.md'
  - 'TanStack/ai:docs/persistence/chat-persistence.md'
  - 'TanStack/ai:docs/persistence/client-persistence.md'
  - 'TanStack/ai:docs/persistence/controls.md'
  - 'TanStack/ai:docs/resumable-streams/overview.md'
---

# Persistence

> **Dependency note:** Builds on ai-core and usually ai-core/chat-experience.

TanStack AI splits **delivery durability** from **state persistence**. They
share no code and solve different problems.

| Layer                   | Answers                             | Package / API                                                                                |
| ----------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------- |
| **Delivery durability** | Reconnect to a stream still running | `memoryStream` / `@tanstack/ai-durable-stream` on the response; see resumable streams docs   |
| **State persistence**   | What is the conversation, later?    | Client `persistence` on `useChat` + server `withPersistence` from `@tanstack/ai-persistence` |

A replayable stream is **not** a saved conversation. A saved conversation is
**not** a live stream. Production apps often use both.

## Sub-skills

| Need to...                                      | Read                                       |
| ----------------------------------------------- | ------------------------------------------ |
| Wire server-side chat history, runs, interrupts | ai-core/persistence/server/SKILL.md        |
| Survive reloads in the browser                  | ai-core/persistence/client/SKILL.md        |
| Pick Drizzle / Prisma / Cloudflare / memory     | ai-core/persistence/backends/SKILL.md      |
| Implement or override store interfaces          | ai-core/persistence/custom-stores/SKILL.md |
| Multi-instance locks (separate from state)      | ai-core/persistence/locks/SKILL.md         |

## State persistence has two halves

| Half       | Stores                                           | Survives                         | Typical use                              |
| ---------- | ------------------------------------------------ | -------------------------------- | ---------------------------------------- |
| **Client** | transcript ± resume pointer in browser storage   | reload / tab close (per browser) | SPA restore, offline-first               |
| **Server** | messages, runs, interrupts, metadata in SQL/D1/… | restart + multi-device           | authoritative history, durable approvals |

They are independent. Use either alone or both.

## Identity: `threadId` and `Scope`

Server stores key on **`threadId`** (same as `chat({ threadId })` /
`ChatMiddlewareContext.threadId` / `Scope.threadId` from `@tanstack/ai`).

- Store methods take bare `threadId` strings for adapter simplicity.
- Multi-user isolation is **your** job: derive `userId` / `tenantId` from
  session server-side; authorize before load/save / `reconstructChat`.
- Never treat a client-supplied thread id alone as ownership — ids are guessable.

## Authoritative-history contract

When both halves run, ownership per turn is decided by request `messages`:

| Client sends             | Meaning                           | On finish                           |
| ------------------------ | --------------------------------- | ----------------------------------- |
| **Non-empty** `messages` | Full transcript (source of truth) | Server **overwrites** stored thread |
| **Empty** `messages`     | Continue from server copy         | Server **loads** stored thread      |

Never post a delta as `messages` — that wipes history down to the delta.

**Client-authoritative:** always send full transcript; browser is truth, server mirrors.  
**Server-authoritative:** send empty `messages` (or hydrate via server load); server is truth, multi-device works.

## Recommended production stack

1. **Client:** `persistence: { store, messages: false }` — resume pointer only.
2. **Server:** `withPersistence(backend)` — messages + runs + interrupts.
3. **Route:** delivery durability if mid-stream reconnect matters.
4. **Optional:** `withLocks(distributedLockStore)` when other middleware needs multi-instance coordination (not part of the state bag).

## Minimal end-to-end sketch

**Server**

```ts
import {
  chat,
  chatParamsFromRequest,
  toServerSentEventsResponse,
} from '@tanstack/ai'
import { openaiText } from '@tanstack/ai-openai'
import { withPersistence } from '@tanstack/ai-persistence'
import { sqlitePersistence } from '@tanstack/ai-persistence-drizzle/sqlite'

const persistence = sqlitePersistence({
  url: 'file:.tanstack-ai/state.sqlite',
})

export async function POST(request: Request) {
  const params = await chatParamsFromRequest(request)
  const stream = chat({
    adapter: openaiText('gpt-5.5'),
    messages: params.messages,
    threadId: params.threadId,
    runId: params.runId,
    ...(params.resume ? { resume: params.resume } : {}),
    middleware: [withPersistence(persistence)],
  })
  return toServerSentEventsResponse(stream)
}
```

**Client (server-authoritative resume pointer)**

```tsx
import {
  useChat,
  fetchServerSentEvents,
  localStoragePersistence,
} from '@tanstack/ai-react'

const store = localStoragePersistence()

function Chat({ threadId }: { threadId: string }) {
  const { messages, sendMessage } = useChat({
    threadId,
    connection: fetchServerSentEvents('/api/chat'),
    persistence: { store, messages: false },
  })
  // ...
}
```

With `messages: false`, the client hydrates the transcript from the server on
mount (thread id is the key). Pair with a server load path such as
`reconstructChat` when you need an explicit GET.

## Critical rules

1. **Not Vercel AI SDK.** Persistence is `@tanstack/ai-persistence` + middleware, not Vercel `useChat` storage hacks.
2. **`saveThread` is full overwrite**, never append.
3. **`createOrResume` is insert-if-absent** for the same `runId`.
4. **Interrupt `create` is insert-if-absent** — never clobber resolved → pending.
5. **Locks ≠ state.** Use `withLocks`, not a field on `AIPersistence.stores`.
6. **Schema-first SQL.** Drizzle/Prisma/D1 do not invent migrations for you — own the journal (see backends skill).
7. **Authorize thread access** at the route boundary.

## Cross-references

- **ai-core/chat-experience** — `useChat`, SSE, client `persistence` option overview
- **ai-core/middleware** — middleware hooks; `withPersistence` is a ChatMiddleware
- **Resumable streams docs** — delivery durability only
