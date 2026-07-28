import { describe, expect, it } from 'vitest'
import { EventType, memoryStream } from '../src/index'
import type { StreamChunk } from '../src/index'

function chunk(delta: string): StreamChunk {
  return {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId: 'm1',
    delta,
    content: delta,
    timestamp: 1,
  } as StreamChunk
}

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

async function readAll(
  durability: ReturnType<typeof memoryStream>,
  from: string,
): Promise<Array<string>> {
  const seen: Array<string> = []
  for await (const event of durability.read(from)) {
    const c = event.chunk as { delta?: string }
    if (c.delta !== undefined) seen.push(c.delta)
  }
  return seen
}

describe('append with caller-supplied offsets', () => {
  it('returns the supplied offsets verbatim', async () => {
    const producer = memoryStream(producerRequest('r-verbatim'))
    const offsets = await producer.append([chunk('a'), chunk('b')], {
      offsets: ['sbx:v1:r-verbatim:0:0', 'sbx:v1:r-verbatim:0:1'],
    })
    expect(offsets).toEqual(['sbx:v1:r-verbatim:0:0', 'sbx:v1:r-verbatim:0:1'])
  })

  it('is idempotent: re-appending the same offsets does not duplicate', async () => {
    const producer = memoryStream(producerRequest('r-idem'))
    await producer.append([chunk('a'), chunk('b')], {
      offsets: ['sbx:v1:r-idem:0:0', 'sbx:v1:r-idem:10:0'],
    })
    // A successor host re-translates the SAME journal bytes.
    await producer.append([chunk('b')], { offsets: ['sbx:v1:r-idem:10:0'] })
    await producer.append([chunk('c')], { offsets: ['sbx:v1:r-idem:20:0'] })
    await producer.close()

    expect(await readAll(memoryStream(joinRequest('r-idem')), '-1')).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('still assigns offsets when none are supplied', async () => {
    const producer = memoryStream(producerRequest('r-auto'))
    const offsets = await producer.append([chunk('a')])
    expect(offsets).toHaveLength(1)
    expect(offsets[0]).toContain('r-auto')
  })

  it('rejects an offsets array whose length does not match chunks', async () => {
    const producer = memoryStream(producerRequest('r-mismatch'))
    await expect(
      producer.append([chunk('a'), chunk('b')], {
        offsets: ['sbx:v1:r-mismatch:0:0'],
      }),
    ).rejects.toThrow(/offsets/)
  })
})
