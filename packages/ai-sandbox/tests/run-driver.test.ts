/**
 * Coverage for the retargeted run driver (`src/run.ts`): `pipeToRunLog` and
 * `RunController` now drive core's `RunStore` + `StreamDurability` pair instead
 * of the package-local event log.
 */
import { describe, expect, it } from 'vitest'
import { EventType, InMemoryRunStore, memoryStream } from '@tanstack/ai'
import { RunController, pipeToRunLog } from '../src'
import type { StreamChunk } from '@tanstack/ai'

function producerRequest(runId: string): Request {
  return new Request(`http://test.local/api/chat?runId=${runId}`, {
    method: 'POST',
  })
}

function joinRequest(runId: string): Request {
  return new Request(`http://test.local/api/chat?runId=${runId}&offset=-1`, {
    method: 'GET',
  })
}

function textChunk(delta: string): StreamChunk {
  return {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: 'm1',
    delta,
    content: delta,
    timestamp: 1,
  } as unknown as StreamChunk
}

async function* twoChunks(): AsyncGenerator<StreamChunk> {
  yield textChunk('hello ')
  yield textChunk('world')
}

async function* throwing(): AsyncGenerator<StreamChunk> {
  yield textChunk('partial')
  throw new Error('provider exploded')
}

/** Build a `RUN_ERROR` chunk, mirroring `syntheticRunError` in `src/run.ts`. */
function runErrorChunk(message: string): StreamChunk {
  const chunk: { type: EventType.RUN_ERROR; message: string } = {
    type: EventType.RUN_ERROR,
    message,
  }
  return chunk
}

async function* chunkThenRunError(): AsyncGenerator<StreamChunk> {
  yield textChunk('partial')
  yield runErrorChunk('provider rejected the request')
}

/** Aborts `controller` between the first and second yielded chunk. */
async function* abortAfterFirstChunk(
  controller: AbortController,
): AsyncGenerator<StreamChunk> {
  yield textChunk('before-abort')
  controller.abort()
  yield textChunk('after-abort')
}

/** Replay a finished run's log from the start and collect every chunk. */
async function replay(runId: string): Promise<Array<StreamChunk>> {
  const chunks: Array<StreamChunk> = []
  for await (const event of memoryStream(joinRequest(runId)).read('-1')) {
    chunks.push(event.chunk)
  }
  return chunks
}

describe('pipeToRunLog', () => {
  it('records a completed run and appends every chunk', async () => {
    const runs = new InMemoryRunStore()
    const durability = memoryStream(producerRequest('r1'))
    const record = await pipeToRunLog(twoChunks(), {
      runs,
      durability,
      runId: 'r1',
      threadId: 't1',
    })

    expect(record.status).toBe('completed')
    expect(record.threadId).toBe('t1')
    expect((await runs.get('r1'))?.status).toBe('completed')

    const deltas: Array<string> = []
    for (const chunk of await replay('r1')) {
      if (chunk.type === EventType.TEXT_MESSAGE_CONTENT)
        deltas.push(chunk.delta)
    }
    expect(deltas).toEqual(['hello ', 'world'])
  })

  it('never rejects on a stream error: records failed plus a RUN_ERROR event', async () => {
    const runs = new InMemoryRunStore()
    const durability = memoryStream(producerRequest('r2'))
    const record = await pipeToRunLog(throwing(), {
      runs,
      durability,
      runId: 'r2',
      threadId: 't1',
    })

    expect(record.status).toBe('failed')
    expect(record.error).toContain('provider exploded')

    const types = (await replay('r2')).map((chunk) => chunk.type)
    expect(types).toContain(EventType.RUN_ERROR)
  })

  it('finishes as aborted when the signal is already aborted', async () => {
    const runs = new InMemoryRunStore()
    const durability = memoryStream(producerRequest('r3'))
    const controller = new AbortController()
    controller.abort()
    const record = await pipeToRunLog(twoChunks(), {
      runs,
      durability,
      runId: 'r3',
      threadId: 't1',
      signal: controller.signal,
    })
    expect(record.status).toBe('aborted')
  })

  it('finishes failed on a RUN_ERROR chunk, capturing its message and logging the event', async () => {
    const runs = new InMemoryRunStore()
    const durability = memoryStream(producerRequest('r6'))
    const record = await pipeToRunLog(chunkThenRunError(), {
      runs,
      durability,
      runId: 'r6',
      threadId: 't1',
    })

    expect(record.status).toBe('failed')
    expect(record.error).toBe('provider rejected the request')

    const events = await replay('r6')
    expect(events.some((chunk) => chunk.type === EventType.RUN_ERROR)).toBe(
      true,
    )
  })

  it('finishes aborted mid-stream, keeping chunks appended before the abort replayable', async () => {
    const runs = new InMemoryRunStore()
    const durability = memoryStream(producerRequest('r7'))
    const controller = new AbortController()
    const record = await pipeToRunLog(abortAfterFirstChunk(controller), {
      runs,
      durability,
      runId: 'r7',
      threadId: 't1',
      signal: controller.signal,
    })

    expect(record.status).toBe('aborted')

    const deltas: Array<string> = []
    for (const chunk of await replay('r7')) {
      if (chunk.type === EventType.TEXT_MESSAGE_CONTENT)
        deltas.push(chunk.delta)
    }
    expect(deltas).toEqual(['before-abort'])
  })
})

describe('RunController', () => {
  it('start returns immediately and done resolves with the terminal record', async () => {
    const runs = new InMemoryRunStore()
    const durability = memoryStream(producerRequest('r4'))
    const controller = new RunController({ runs, durability })
    const handle = controller.start({
      runId: 'r4',
      threadId: 't1',
      stream: twoChunks(),
    })
    expect(handle.runId).toBe('r4')
    const record = await handle.done
    expect(record.status).toBe('completed')
  })

  it('status reads the record and drain awaits in-flight runs', async () => {
    const runs = new InMemoryRunStore()
    const durability = memoryStream(producerRequest('r5'))
    const controller = new RunController({ runs, durability })
    controller.start({ runId: 'r5', threadId: 't1', stream: twoChunks() })
    await controller.drain()
    expect((await controller.status('r5'))?.status).toBe('completed')
  })

  it("attach replays from an opaque offset (memoryStream's '-1' from-start sentinel)", async () => {
    const runs = new InMemoryRunStore()
    const durability = memoryStream(producerRequest('r8'))
    const controller = new RunController({ runs, durability })
    const handle = controller.start({
      runId: 'r8',
      threadId: 't1',
      stream: twoChunks(),
    })
    await handle.done

    const deltas: Array<string> = []
    for await (const event of controller.attach('-1')) {
      if (event.chunk.type === EventType.TEXT_MESSAGE_CONTENT)
        deltas.push(event.chunk.delta)
    }
    expect(deltas).toEqual(['hello ', 'world'])
  })
})
