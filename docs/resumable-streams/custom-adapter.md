---
title: Custom Durability Adapter
id: custom-adapter
description: "Back resumable streams with your own store (Redis, Postgres, a queue) by implementing the four-method StreamDurability contract."
keywords:
  - custom durability adapter
  - StreamDurability
  - resumable streams
  - redis durable stream
  - postgres durable stream
  - delivery durability
---

# Custom Durability Adapter

You have a store you want streams to survive on: Redis, Postgres, a queue,
Electric, an object store. By the end of this page you have a `StreamDurability`
adapter that plugs into `toServerSentEventsResponse` / `toHttpResponse`, so a
client can reconnect to an in-flight run without re-running the model.

Core never understands your store. It only round-trips opaque offset strings you
hand it. You implement four methods:

| Method | Job |
| --- | --- |
| `resumeFrom()` | Return the resume offset from this request, or `null` for a fresh run. |
| `append(chunks, opts)` | Persist a batch before delivery; return one offset per chunk, in order. See [Handling caller-supplied offsets](#handling-caller-supplied-offsets) for `opts.offsets`. |
| `read(offset, signal)` | Replay chunks strictly after `offset`. |
| `close()` | Mark the run complete and wake any parked readers. |

## The rules that matter

Get these wrong and resume breaks in subtle ways:

- **Offsets are opaque, unique, and round-trip-safe.** Return a distinct offset
  per chunk. It travels on an SSE `id:` line or inside an NDJSON `{ id, chunk }`
  envelope, so it must survive that: core rejects an empty offset, one
  containing `NUL`/CR/LF, one with leading or trailing whitespace, or a
  duplicate.
- **`read` replays strictly *after* the offset**, oldest first, and stops at the
  first `RUN_FINISHED` / `RUN_ERROR`.
- **`read` must never end the response empty while the run is still producing.**
  Park (wait for the next append) instead. A clean end with no new data tells
  the client the run is over; if it isn't, the client fails with
  `DurableStreamIncompleteError`. Honor the abort `signal` so a gone client
  stops the wait.
- You do not handle ordering or append-before-deliver. Core buffers, calls
  `append`, and only forwards a chunk once you return its offset.
- **`append` takes an optional second argument, `opts.offsets`.** Ignoring it
  silently is the one broken choice: it type-checks but throws away the
  idempotency the parameter exists for. See
  [Handling caller-supplied offsets](#handling-caller-supplied-offsets).

## Implement it

Write the adapter against your store's operations. Here it is over an
append-only per-run log you provide; swap `RunLog` for your backend:

```ts ignore
import { EventType } from '@tanstack/ai'
import type { StreamChunk, StreamDurability } from '@tanstack/ai'

// Your backend, one append-only log per run. Back it with Redis Streams, a
// Postgres table, a queue. Anything that returns a stable cursor per entry.
// `upsert` writes at caller-chosen cursors, replacing rather than duplicating
// an entry that already exists at that cursor (a Postgres
// `INSERT ... ON CONFLICT (cursor) DO UPDATE`, or a Redis `XADD` with an
// explicit, deduplicated ID).
interface RunLog {
  append: (chunks: Array<StreamChunk>) => Promise<Array<string>>
  upsert: (
    chunks: Array<StreamChunk>,
    cursors: Array<string>,
  ) => Promise<Array<string>>
  readAfter: (
    cursor: string | null,
  ) => Promise<Array<{ cursor: string; chunk: StreamChunk }>>
  isComplete: () => Promise<boolean>
  waitForChange: (signal?: AbortSignal) => Promise<void>
  markComplete: () => Promise<void>
}

function isTerminal(chunk: StreamChunk): boolean {
  return chunk.type === EventType.RUN_FINISHED || chunk.type === EventType.RUN_ERROR
}

export function customDurability(
  request: Request,
  openLog: (runId: string) => RunLog,
): StreamDurability {
  const url = new URL(request.url)
  // The resume offset: native SSE reconnect header first, then a join's ?offset.
  const resume =
    request.headers.get('Last-Event-ID') ?? url.searchParams.get('offset')
  // Your adapter owns run identity. A real backend decodes the runId from the
  // resume offset; this example takes the client's chosen id from the
  // X-Run-Id header (a POST producer) or the ?runId query (a GET join), and
  // otherwise mints a fresh one.
  const runId =
    request.headers.get('X-Run-Id') ??
    url.searchParams.get('runId') ??
    crypto.randomUUID()
  const log = openLog(runId)

  return {
    resumeFrom: () => resume,
    append: (chunks, opts) =>
      opts?.offsets ? log.upsert(chunks, opts.offsets) : log.append(chunks),
    close: () => log.markComplete(),
    read: async function* (offset, signal) {
      // '-1' / 'now' are the from-start / from-tail join sentinels.
      let cursor: string | null = offset === '-1' ? null : offset
      for (;;) {
        if (signal?.aborted) return
        const entries = await log.readAfter(cursor)
        for (const entry of entries) {
          cursor = entry.cursor
          yield { offset: entry.cursor, chunk: entry.chunk }
          if (isTerminal(entry.chunk)) return
        }
        if (await log.isComplete()) return
        // Park. Do NOT end the response here while the producer is alive.
        await log.waitForChange(signal)
      }
    },
  }
}
```

Wire it up exactly like the built-in adapters:

```ts
import { chat, chatParamsFromRequest, toServerSentEventsResponse } from '@tanstack/ai'
import { openaiText } from '@tanstack/ai-openai'
// Your modules: the adapter above, and your backend's per-run log factory.
import { customDurability } from './durability'
import { openRunLog } from './run-log'

export async function POST(request: Request) {
  const { messages, threadId, runId } = await chatParamsFromRequest(request)
  const stream = chat({ adapter: openaiText('gpt-5.5'), messages, threadId, runId })
  return toServerSentEventsResponse(stream, {
    durability: { adapter: customDurability(request, openRunLog) },
  })
}
```

For NDJSON, swap `toServerSentEventsResponse` for `toHttpResponse`. The adapter
is identical; only the wire encoding changes.

## Handling caller-supplied offsets

A caller can invoke `append(chunks, { offsets })` with offsets it chose itself
instead of letting your adapter assign them. You have two honest options:

**Upsert**, if your store can write at a caller-chosen key: appending the same
chunk at the same offset twice must leave one entry, not two. That is what
`log.upsert` does in the example above, and what `memoryStream` does
internally.

**Reject**, if your store assigns its own cursor on write and can't honor a
caller's choice. This is what `durableStream` does: its offsets embed a
backend-assigned cursor, so it throws before creating anything rather than
silently dropping the caller's intent.

```ts ignore
append: (chunks, opts) => {
  if (opts?.offsets) {
    throw new Error('this adapter does not support caller-supplied offsets')
  }
  return log.append(chunks)
},
```

Either is fine. The one broken choice is accepting `opts.offsets` in the
signature and then ignoring it: the call type-checks, but the idempotency the
caller asked for silently disappears.

When you do implement the upsert, the contract requires `opts.offsets` to be
the same length as `chunks`, one offset per chunk in order, same as the
return value. `memoryStream` validates this defensively and throws on a
mismatch; do the same in your own adapter rather than trusting the caller.

## Type your offsets (optional)

`StreamDurability<TOffset>` is generic over the offset string. Brand it so a
raw string can't be passed where one of your offsets is expected:

```ts
import type { StreamDurability } from '@tanstack/ai'

type MyOffset = string & { readonly __brand: 'MyOffset' }

// Your adapter is then StreamDurability<MyOffset>; append/read/resumeFrom all
// speak MyOffset, and a plain string won't type-check where one is expected.
type MyAdapter = StreamDurability<MyOffset>
```

Core still treats the value as opaque; the brand only tightens your own code.

## Terminalization is on you

Core awaits `close()` on every producer exit (normal completion, cancellation,
and failure) and appends a terminal `RUN_ERROR` on cancel/failure before
closing. Your `close()` must make `read`'s `isComplete()` return `true` and wake
parked readers, so a caught-up reader stops rather than hanging. If your backend
producer can die without running `close()` (process crash), add a lease/reaper
that terminalizes abandoned logs. See [Process death](./advanced#process-death).
