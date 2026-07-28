import { createFileRoute } from '@tanstack/react-router'
import { toServerSentEventsResponse } from '@tanstack/ai'
import type { StreamChunk } from '@tanstack/ai'

/**
 * Provider-free harness route for the SERVER-DRIVEN generation-persistence
 * story (`persistence: true` + `threadId`). It is the server-authoritative
 * counterpart to `api.generation-persistence.ts` (the client-driven
 * `localStoragePersistence` variant).
 *
 * The client keeps NO local store; on mount it probes the GET below with a
 * `?threadId=` query and repaints from the returned `reconstructGeneration`-
 * shaped JSON (`{ resumeSnapshot, activeRun }`). To make the round-trip real,
 * POST records the finished job in a module-level in-memory map keyed by
 * `threadId`, and GET reads it back — so a full `page.reload()` (empty client
 * storage) still restores the last run's status + result metadata FROM THE
 * SERVER, exactly the path `reconstructGeneration` serves in production.
 *
 * We hand-build the JSON here rather than pull `@tanstack/ai-persistence` into
 * the e2e app (it is not a dependency) — mirroring the `server-interrupt`
 * scenario in `api.persistence-durability.ts`. `reconstructGeneration` itself is
 * unit-tested in `@tanstack/ai-persistence`; this proves the CLIENT hydrate.
 *
 * Exempt from the aimock policy: this route streams a fixed AG-UI sequence and
 * never reaches an LLM provider's HTTP layer, so there is nothing to mock.
 */

// 1x1 transparent PNG — small enough to prove media bytes are NOT persisted.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// Server-authoritative record of the last completed generation per thread. In
// production this is a `GenerationJobStore` row; here a process-lifetime map is
// enough for the reload round-trip (the e2e server stays up across reloads).
const completedByThread = new Map<string, { id: string; model: string }>()

function stringField(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null || !(key in body)) {
    return undefined
  }
  const value: unknown = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

function imageRun(threadId: string, runId: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield {
      type: 'RUN_STARTED',
      threadId,
      runId,
      timestamp: Date.now(),
    } as StreamChunk
    yield {
      type: 'CUSTOM',
      name: 'generation:result',
      value: {
        id: 'image-1',
        model: 'mock-image-model',
        images: [{ b64Json: TINY_PNG_B64 }],
      },
      threadId,
      runId,
      timestamp: Date.now(),
    } as StreamChunk
    yield {
      type: 'RUN_FINISHED',
      threadId,
      runId,
      timestamp: Date.now(),
    } as StreamChunk
    // The run finished: record the job the way `withGenerationPersistence`
    // would, so the GET hydrate below can restore it after a reload.
    completedByThread.set(threadId, {
      id: 'image-1',
      model: 'mock-image-model',
    })
  })()
}

export const Route = createFileRoute('/api/generation-persistence-server')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        // The client sends an AG-UI RunAgentInput body carrying the hook's
        // stable `threadId` (via runContext) — the same id the GET hydrate
        // probe queries — plus the run id in the X-Run-Id header.
        const body: unknown = await request.json()
        const threadId = stringField(body, 'threadId') ?? 'generation-server'
        const runId =
          request.headers.get('X-Run-Id') ??
          stringField(body, 'runId') ??
          `run-${Date.now()}`
        return toServerSentEventsResponse(imageRun(threadId, runId))
      },

      // Server-authoritative hydration: the `persistence: true` client's mount
      // probe (`?threadId=`). Returns the same `{ resumeSnapshot, activeRun }`
      // shape `reconstructGeneration` produces — a `complete` snapshot once the
      // thread has a recorded job, else the empty first-load answer.
      GET: ({ request }) => {
        const threadId = new URL(request.url).searchParams.get('threadId') ?? ''
        const job = threadId ? completedByThread.get(threadId) : undefined
        const body = job
          ? {
              resumeSnapshot: {
                schemaVersion: 1,
                resumeState: null,
                status: 'complete',
                result: job,
                activity: 'image',
              },
              activeRun: null,
            }
          : { resumeSnapshot: null, activeRun: null }
        return new Response(JSON.stringify(body), {
          headers: {
            'content-type': 'application/json',
            'cache-control': 'no-store',
          },
        })
      },
    },
  },
})
