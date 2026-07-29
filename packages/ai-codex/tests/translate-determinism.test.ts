/**
 * Determinism of the codex translator on the journaled path.
 *
 * WHAT THIS COVERS: `translateThreadEvents` mints message ids only through
 * `ctx.genId` (used for `TOOL_CALL_RESULT.messageId`, both the resolved-item
 * path and `synthesizeUnresolvedResults`). Replaying the exact same journal
 * bytes through a fresh `createRunScopedIdGen(runId)` each time must produce
 * an identical chunk sequence (compared via `chunkFingerprint`, which drops
 * only the wall-clock `timestamp` field) — this is the load-bearing property
 * `alignToStoredLog` (a later phase) depends on to recognize what a previous
 * host already delivered and suppress it.
 *
 * WHAT THIS DOES NOT COVER: in the real adapter
 * (`packages/ai-codex/src/adapters/text.ts`), `translateThreadEvents`'s
 * output is not what gets delivered on its own — it is piped through
 * `mergeChunkStreams(translated, channel.stream)`, where `channel.stream`
 * carries CUSTOM events from the host-tool-bridge, produced by *live* tool
 * execution. On a journal replay:
 *   1. No live tools run, so those bridged events do not occur at all.
 *   2. Even for the original run, where they interleave relative to the
 *      translated chunks is timing-dependent, not something recoverable
 *      from the journal.
 * So a deterministic translator (proven here) does NOT imply the adapter's
 * actually-delivered, post-merge stream is deterministic for any run that
 * used bridged tools. This test only exercises `translateThreadEvents` in
 * isolation and intentionally makes no claim about `mergeChunkStreams`
 * output — that gap is left open for Phase 3 to scope, not fixed here.
 */
import { describe, expect, it } from 'vitest'
import { chunkFingerprint, createRunScopedIdGen } from '@tanstack/ai-sandbox'
import { translateThreadEvents } from '../src/stream/translate'
import type { StreamChunk } from '@tanstack/ai'
import type { CodexThreadEvent } from '../src/stream/sdk-types'

/**
 * Real codex thread-event shapes, copied from `tests/translate.test.ts` and
 * `src/stream/sdk-types.ts` (not invented): a session start, a command
 * execution that starts and completes (exercising the TOOL_CALL_RESULT path
 * that calls `genId()`), an assistant message, and turn completion.
 */
const JOURNAL_EVENTS: Array<CodexThreadEvent> = [
  { type: 'thread.started', thread_id: 'sess-1' },
  { type: 'turn.started' },
  {
    type: 'item.started',
    item: {
      id: 'cmd-1',
      type: 'command_execution',
      command: 'ls',
      status: 'in_progress',
    },
  },
  {
    type: 'item.completed',
    item: {
      id: 'cmd-1',
      type: 'command_execution',
      command: 'ls',
      aggregated_output: 'file.txt\n',
      exit_code: 0,
      status: 'completed',
    },
  },
  {
    type: 'item.completed',
    item: { id: 'item-1', type: 'agent_message', text: 'Done.' },
  },
  {
    type: 'turn.completed',
    usage: { input_tokens: 10, output_tokens: 5 },
  },
]

async function* replay(): AsyncIterable<CodexThreadEvent> {
  for (const event of JOURNAL_EVENTS) {
    // Mirrors the async, one-event-at-a-time delivery a journal reader
    // provides — not a synchronous array iteration.
    await Promise.resolve()
    yield event
  }
}

async function fingerprintRun(genId: () => string): Promise<Array<string>> {
  const out: Array<string> = []
  const chunks: AsyncIterable<StreamChunk> = translateThreadEvents(replay(), {
    model: 'gpt-5.1-codex',
    runId: 'run-1',
    threadId: 'thread-1',
    genId,
  })
  for await (const chunk of chunks) out.push(chunkFingerprint(chunk))
  return out
}

describe('codex translation determinism (journaled path)', () => {
  it('produces the identical chunk sequence when the same journal is replayed twice', async () => {
    // This is the load-bearing property of journal replay: without it,
    // alignToStoredLog cannot recognize what a previous host already
    // delivered, and a resume would duplicate or corrupt output (see the
    // Phase 2 plan's "Reason 2" for why non-determinism kills the replay
    // mechanism outright).
    const first = await fingerprintRun(createRunScopedIdGen('run-1'))
    const second = await fingerprintRun(createRunScopedIdGen('run-1'))
    expect(first.length).toBeGreaterThan(0)
    expect(second).toEqual(first)
  })

  it('diverges when genId is NOT run-scoped, proving the test has teeth', async () => {
    const randomGenId = (): string =>
      `${Math.random().toString(36)}-${Date.now()}`
    const first = await fingerprintRun(randomGenId)
    const second = await fingerprintRun(randomGenId)
    expect(first).not.toEqual(second)
  })
})
