import { createFileRoute } from '@tanstack/react-router'
import { toServerSentEventsResponse } from '@tanstack/ai'
import type { StreamChunk } from '@tanstack/ai'

/**
 * Provider-free harness route for the generation-persistence reload story.
 * Streams a FIXED generation AG-UI sequence (started → progress → result →
 * finished) instead of calling an image model, so the e2e is deterministic
 * with nothing to mock.
 *
 * Exempt from the aimock policy: this route streams a fixed AG-UI sequence and
 * never reaches an LLM provider's HTTP layer, so there is nothing to mock.
 */

// 1x1 transparent PNG — small enough to prove media bytes are NOT persisted.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

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
      name: 'generation:progress',
      value: { progress: 50, message: 'Painting pixels' },
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
  })()
}

export const Route = createFileRoute('/api/generation-persistence')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const runId = request.headers.get('X-Run-Id') ?? `run-${Date.now()}`
        const threadId =
          request.headers.get('X-Thread-Id') ?? 'generation-persistence'
        return toServerSentEventsResponse(imageRun(threadId, runId))
      },
    },
  },
})
