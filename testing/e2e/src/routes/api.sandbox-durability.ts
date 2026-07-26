import { createFileRoute } from '@tanstack/react-router'
import {
  EventType,
  InMemoryLockStore,
  InMemorySandboxStore,
  chat,
} from '@tanstack/ai'
import {
  defineSandbox,
  defineWorkspace,
  withSandbox,
} from '@tanstack/ai-sandbox'
import {
  memoryPersistence,
  withLocks,
  withPersistence,
} from '@tanstack/ai-persistence'
import type { AnyTextAdapter, StreamChunk } from '@tanstack/ai'
import type { SandboxHandle, SandboxProvider } from '@tanstack/ai-sandbox'

/**
 * Server-side sandbox-persistence durability harness.
 *
 * Proves that a durable `SandboxStore` (here an in-memory singleton standing in
 * for a backend) makes sandbox resume durable ACROSS independent runs: each
 * POST is a fresh `chat()` with a brand-new middleware context, and the ONLY
 * shared state is the module-singleton store. A second run for the same
 * `threadId` must RESUME the sandbox the first run created, not create a
 * second one.
 *
 * Provider-free: a fixed AG-UI stream and a fake sandbox provider, so there is
 * no LLM in the loop (exempt from the aimock policy).
 */

// Module-singleton state — survives between the two HTTP requests.
const sandboxStore = new InMemorySandboxStore()
const locks = new InMemoryLockStore()
const chatStores = memoryPersistence().stores
const persistence = {
  stores: {
    ...chatStores,
    sandbox: sandboxStore,
  },
}
const calls = { create: 0, resume: 0 }

function fakeHandle(id: string): SandboxHandle {
  return {
    id,
    provider: 'fake',
    capabilities: {
      fs: true,
      exec: true,
      env: true,
      ports: false,
      backgroundProcesses: false,
      writableStdin: false,
      snapshots: false,
      networkPolicy: false,
      durableFilesystem: false,
      fork: false,
    },
    fs: {
      read: () => Promise.resolve(''),
      readBytes: () => Promise.resolve(new Uint8Array()),
      write: () => Promise.resolve(),
      list: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      rename: () => Promise.resolve(),
      exists: () => Promise.resolve(false),
    },
    git: {
      clone: () => Promise.resolve(),
      status: () => Promise.resolve(''),
      add: () => Promise.resolve(),
      commit: () => Promise.resolve(),
      push: () => Promise.resolve(),
      pull: () => Promise.resolve(),
      branch: () => Promise.resolve('main'),
    },
    process: {
      exec: () => Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      spawn: () => Promise.reject(new Error('not supported')),
    },
    ports: { connect: () => Promise.reject(new Error('not supported')) },
    env: { set: () => Promise.resolve() },
    destroy: () => Promise.resolve(),
  }
}

const provider: SandboxProvider = {
  name: 'fake',
  capabilities: () => fakeHandle('probe').capabilities,
  create: (input) => {
    calls.create++
    return Promise.resolve(fakeHandle(input.id ?? 'fake-sandbox'))
  },
  resume: (input) => {
    calls.resume++
    return Promise.resolve(fakeHandle(input.id))
  },
  destroy: () => Promise.resolve(),
}

const sandbox = defineSandbox({
  id: 'durable',
  provider,
  workspace: defineWorkspace({ source: { type: 'none' } }),
  fileEvents: false,
})

function fixedRun(threadId: string, runId: string): AsyncIterable<StreamChunk> {
  return (async function* () {
    yield { type: EventType.RUN_STARTED, threadId, runId, timestamp: 1 }
    yield {
      type: EventType.RUN_FINISHED,
      threadId,
      runId,
      finishReason: 'stop',
      timestamp: 1,
    }
  })()
}

const adapter: AnyTextAdapter = {
  kind: 'text',
  name: 'fixed',
  model: 'test-model',
  '~types': {},
  chatStream: ({ runId, threadId }: { runId: string; threadId: string }) =>
    fixedRun(threadId, runId),
  structuredOutput: () => Promise.resolve({ data: {}, rawText: '{}' }),
} as unknown as AnyTextAdapter

function stringField(body: unknown, key: string): string | undefined {
  if (typeof body !== 'object' || body === null || !(key in body)) {
    return undefined
  }
  const value: unknown = (body as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : undefined
}

export const Route = createFileRoute('/api/sandbox-durability')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body: unknown = await request.json()
        const threadId = stringField(body, 'threadId') ?? 'sandbox-thread'
        const runId = stringField(body, 'runId') ?? crypto.randomUUID()

        // Drain a full run so setup (ensure) and the terminal hooks all execute.
        const stream = chat({
          adapter,
          messages: [{ role: 'user', content: 'go' }],
          runId,
          threadId,
          middleware: [
            withPersistence(persistence),
            withLocks(locks),
            withSandbox(sandbox),
          ],
        })
        for await (const _ of stream) void _

        const record = await sandboxStore.get(sandbox.key({ threadId, runId }))
        return Response.json({
          create: calls.create,
          resume: calls.resume,
          providerSandboxId: record?.providerSandboxId ?? null,
          latestRunId: record?.latestRunId ?? null,
        })
      },
    },
  },
})
