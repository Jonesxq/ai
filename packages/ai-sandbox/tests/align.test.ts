import { describe, expect, it } from 'vitest'
import { EventType, memoryStream } from '@tanstack/ai'
import { JournalReplayDivergedError, alignToStoredLog } from '../src/align'
import type { StreamChunk, StreamDurability } from '@tanstack/ai'

/**
 * `memoryStream` keys its log map by runId at MODULE scope, so a reused runId
 * silently inherits another test's entries. Every case below gets its own.
 */
function producerRequest(runId: string): Request {
  return new Request(`http://test.local/api/chat?runId=${runId}`, {
    method: 'POST',
  })
}

function textChunk(messageId: string, delta: string): StreamChunk {
  return {
    type: EventType.TEXT_MESSAGE_CONTENT,
    messageId,
    delta,
    timestamp: 1,
  }
}

async function* fromChunks(
  chunks: Array<StreamChunk>,
): AsyncIterable<StreamChunk> {
  for (const chunk of chunks) {
    await Promise.resolve()
    yield chunk
  }
}

async function collectDeltas(
  it: AsyncIterable<StreamChunk>,
): Promise<Array<string>> {
  const out: Array<string> = []
  for await (const chunk of it) {
    if (chunk.type === EventType.TEXT_MESSAGE_CONTENT) out.push(chunk.delta)
  }
  return out
}

describe('alignToStoredLog', () => {
  it('passes everything through when the log is empty (a fresh run)', async () => {
    const durability = memoryStream(producerRequest('align-fresh'))
    const replay = fromChunks([textChunk('m1', 'a'), textChunk('m1', 'b')])
    expect(
      await collectDeltas(alignToStoredLog(replay, { durability })),
    ).toEqual(['a', 'b'])
  })

  it('suppresses the stored prefix and yields only the remainder', async () => {
    const durability = memoryStream(producerRequest('align-partial'))
    await durability.append([textChunk('m1', 'a'), textChunk('m1', 'b')])

    const replay = fromChunks([
      textChunk('m1', 'a'),
      textChunk('m1', 'b'),
      textChunk('m1', 'c'),
      textChunk('m1', 'd'),
    ])
    expect(
      await collectDeltas(alignToStoredLog(replay, { durability })),
    ).toEqual(['c', 'd'])
  })

  it('yields nothing when the log already holds the whole replay', async () => {
    const durability = memoryStream(producerRequest('align-complete'))
    await durability.append([textChunk('m1', 'a'), textChunk('m1', 'b')])
    const replay = fromChunks([textChunk('m1', 'a'), textChunk('m1', 'b')])
    expect(
      await collectDeltas(alignToStoredLog(replay, { durability })),
    ).toEqual([])
  })

  it('matches on the fingerprint, not identity or JSON text: timestamp drift and key reordering still align', async () => {
    // The journal round-trips every chunk through NDJSON, which preserves
    // neither object identity nor key order, and `timestamp` is wall-clock and
    // unreproducible. A comparison by reference or by `JSON.stringify` would
    // report a divergence here.
    const durability = memoryStream(producerRequest('align-fingerprint'))
    await durability.append([
      {
        type: EventType.TEXT_MESSAGE_CONTENT,
        messageId: 'm1',
        delta: 'a',
        timestamp: 1,
      },
    ])
    const replay = fromChunks([
      {
        delta: 'a',
        timestamp: 999_999,
        messageId: 'm1',
        type: EventType.TEXT_MESSAGE_CONTENT,
      },
      textChunk('m1', 'b'),
    ])
    expect(
      await collectDeltas(alignToStoredLog(replay, { durability })),
    ).toEqual(['b'])
  })

  it('throws JournalReplayDivergedError when the very first chunk differs', async () => {
    const durability = memoryStream(producerRequest('align-diverge-0'))
    await durability.append([textChunk('m1', 'a'), textChunk('m1', 'b')])

    // A nondeterministic messageId is exactly what this must catch.
    const replay = fromChunks([textChunk('m2', 'a'), textChunk('m1', 'b')])
    let caught: unknown
    try {
      await collectDeltas(alignToStoredLog(replay, { durability }))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(JournalReplayDivergedError)
    if (caught instanceof JournalReplayDivergedError) {
      expect(caught.index).toBe(0)
      expect(caught.stored).toContain('"messageId":"m1"')
      expect(caught.replayed).toContain('"messageId":"m2"')
    }
  })

  it('throws mid-prefix, reporting the diverging index and both fingerprints', async () => {
    const durability = memoryStream(producerRequest('align-diverge-mid'))
    await durability.append([
      textChunk('m1', 'a'),
      textChunk('m1', 'b'),
      textChunk('m1', 'c'),
    ])
    const replay = fromChunks([
      textChunk('m1', 'a'),
      textChunk('m1', 'X'),
      textChunk('m1', 'c'),
    ])
    let caught: unknown
    try {
      await collectDeltas(alignToStoredLog(replay, { durability }))
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(JournalReplayDivergedError)
    if (caught instanceof JournalReplayDivergedError) {
      expect(caught.index).toBe(1)
      expect(caught.stored).toContain('"delta":"b"')
      expect(caught.replayed).toContain('"delta":"X"')
    }
  })

  it('yields nothing before it throws on a divergence, so no chunk escapes the mismatch', async () => {
    const durability = memoryStream(producerRequest('align-diverge-no-yield'))
    await durability.append([textChunk('m1', 'a'), textChunk('m1', 'b')])
    const replay = fromChunks([
      textChunk('m1', 'a'),
      textChunk('m1', 'X'),
      textChunk('m1', 'c'),
    ])
    const seen: Array<string> = []
    await expect(async () => {
      for await (const chunk of alignToStoredLog(replay, { durability })) {
        if (chunk.type === EventType.TEXT_MESSAGE_CONTENT)
          seen.push(chunk.delta)
      }
    }).rejects.toThrow(JournalReplayDivergedError)
    expect(seen).toEqual([])
  })

  it('throws when the replay is SHORTER than the log rather than silently truncating', async () => {
    // A shorter replay means the journal lost bytes a previous host translated.
    // Continuing would produce a run whose log claims events the journal cannot
    // account for.
    const durability = memoryStream(producerRequest('align-short'))
    await durability.append([textChunk('m1', 'a'), textChunk('m1', 'b')])
    const replay = fromChunks([textChunk('m1', 'a')])
    await expect(
      collectDeltas(alignToStoredLog(replay, { durability })),
    ).rejects.toThrow(/shorter than the stored log/)
  })

  it('throws when the replay is empty but the log is not', async () => {
    const durability = memoryStream(producerRequest('align-empty-replay'))
    await durability.append([textChunk('m1', 'a')])
    await expect(
      collectDeltas(alignToStoredLog(fromChunks([]), { durability })),
    ).rejects.toThrow(/shorter than the stored log/)
  })

  it('reads a still-OPEN log and terminates (the takeover case: the host that would have closed it died)', async () => {
    const durability = memoryStream(producerRequest('align-open-log'), {
      firstChunkDeadlineMs: 10_000,
    })
    await durability.append([textChunk('m1', 'a')])

    // Prove the log really is open: a tailing `read` does NOT return here,
    // which is precisely why alignment must use `snapshot()` instead.
    const controller = new AbortController()
    const tail = (async () => {
      for await (const _entry of durability.read('-1', controller.signal)) {
        // drain
      }
    })()
    const raced = await Promise.race([
      tail.then(() => 'read-returned'),
      new Promise<string>((resolve) =>
        setTimeout(() => resolve('still-tailing'), 50),
      ),
    ])
    expect(raced).toBe('still-tailing')

    // The alignment itself must complete against that same open log. The
    // explicit per-test timeout turns a non-terminating implementation into a
    // fast failure rather than a hung suite.
    const replay = fromChunks([textChunk('m1', 'a'), textChunk('m1', 'b')])
    expect(
      await collectDeltas(alignToStoredLog(replay, { durability })),
    ).toEqual(['b'])

    controller.abort()
    await tail
  }, 2_000)

  it('reads the stored prefix exactly once, before consuming any replay chunk', async () => {
    const durability = memoryStream(producerRequest('align-once'))
    await durability.append([textChunk('m1', 'a')])

    let pulled = 0
    let snapshots = 0
    let pulledAtFirstSnapshot = -1
    const counted: StreamDurability = {
      ...durability,
      snapshot: () => {
        if (snapshots === 0) pulledAtFirstSnapshot = pulled
        snapshots += 1
        return durability.snapshot()
      },
    }

    async function* counting(): AsyncIterable<StreamChunk> {
      for (const chunk of [
        textChunk('m1', 'a'),
        textChunk('m1', 'b'),
        textChunk('m1', 'c'),
      ]) {
        pulled += 1
        yield chunk
      }
    }

    expect(
      await collectDeltas(
        alignToStoredLog(counting(), { durability: counted }),
      ),
    ).toEqual(['b', 'c'])
    expect(snapshots).toBe(1)
    expect(pulledAtFirstSnapshot).toBe(0)
    expect(pulled).toBe(3)
  })
})
