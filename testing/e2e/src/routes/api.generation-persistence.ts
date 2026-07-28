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

// 1x1 transparent PNG — the live result's inline bytes. Never persisted; the
// snapshot keeps only metadata + the durable artifact ref below.
const TINY_PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// Durable app-origin serve URL for the generated image, the way
// `withGenerationPersistence`'s `artifactUrl` would stamp it. The reload path
// rebuilds `result.images` from this, so the restored image renders from our
// own origin instead of the (never-persisted) inline bytes.
const DURABLE_IMAGE_URL = '/durable/generation-persistence/image-1.png'

function imageArtifact(threadId: string, runId: string) {
  return {
    role: 'output',
    artifactId: 'artifact-image-1',
    threadId,
    runId,
    name: 'image-1.png',
    mimeType: 'image/png',
    size: 68,
    createdAt: new Date(0).toISOString(),
    url: DURABLE_IMAGE_URL,
    source: {
      activity: 'image',
      path: 'images.0',
      provider: 'mock',
      model: 'mock-image-model',
      mediaType: 'image',
    },
  }
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
        artifacts: [imageArtifact(threadId, runId)],
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
