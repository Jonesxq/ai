/**
 * Determinism of the journaled path's translation step.
 *
 * `text.ts` wires `createRunScopedIdGen(runId)` as `translateSdkStream`'s
 * `genId` for the NDJSON/journal call site (see `text.ts` around the
 * `spawnNdjson` call and the `mergeChunkStreams` call just below it). A
 * resuming host re-reads the sandbox journal from byte 0 and re-translates
 * it from scratch, so re-translating the same journal bytes must reproduce
 * the same chunks (via `chunkFingerprint`, which is key-order independent
 * and excludes only the wall-clock `timestamp` field) — otherwise a replay
 * cannot recognize what a dead host already delivered and would duplicate
 * text / corrupt tool-call JSON (the client de-dups by offset only, and the
 * stream processor appends unconditionally).
 *
 * What this test covers: `translateSdkStream` alone, fed the same fixture
 * messages twice through two fresh `createRunScopedIdGen(runId)` generators,
 * asserting the two fingerprint arrays are equal — plus a mutation-style
 * "teeth check" that a *non*-run-scoped (random) `genId` makes them diverge.
 *
 * What this test does NOT cover, and why that's a known, accepted gap:
 * `text.ts`'s `chatStream` does not yield `translateSdkStream`'s output
 * directly — it wraps it as
 * `mergeChunkStreams(translateSdkStream(...), channel.stream)`
 * (`packages/ai-claude-code/src/adapters/text.ts:445`). `channel.stream`
 * carries host-tool-bridge CUSTOM events produced by *live* tool execution
 * (`createBridgeEventChannel`, from `@tanstack/ai-sandbox`). On replay:
 *   - those bridge events do not occur at all (no live tool execution
 *     happens during a re-translation of journaled bytes), and
 *   - `mergeChunkStreams`'s interleaving of two async sources is
 *     timing-dependent regardless of any id determinism.
 * So determinism at the `translateSdkStream` level (proven here) does NOT
 * imply determinism of the full *delivered* stream for a run that used
 * bridged tools — that gap is real and is not fixed by this change. It is
 * recorded here deliberately so a later replay/resume phase does not
 * rediscover it as a mysterious mismatch (e.g. a `JournalReplayDivergedError`
 * on a bridged-tool run) without context. Fixing it (e.g. by excluding
 * `channel.stream` from what gets journaled/replayed, or replaying it
 * separately) is out of scope for this task.
 */
import { describe, expect, it } from 'vitest'
import { createRunScopedIdGen, chunkFingerprint } from '@tanstack/ai-sandbox'
import { translateSdkStream } from '../src/stream/translate'
import type { AgentSdkMessage } from '../src/stream/sdk-types'
import type { StreamChunk } from '@tanstack/ai'

async function* fromArray(
  messages: Array<AgentSdkMessage>,
): AsyncIterable<AgentSdkMessage> {
  for (const message of messages) {
    yield message
  }
}

async function translate(
  messages: Array<AgentSdkMessage>,
  runId: string,
  genId: () => string,
): Promise<Array<StreamChunk>> {
  const chunks: Array<StreamChunk> = []
  for await (const chunk of translateSdkStream(fromArray(messages), {
    model: 'claude-opus-4-6',
    runId,
    threadId: 'thread-1',
    genId,
  })) {
    chunks.push(chunk)
  }
  return chunks
}

// Real event shapes copied from `packages/ai-claude-code/tests/translate.test.ts`
// and `packages/ai-claude-code/src/stream/translate.ts` — a text turn plus a
// resolved tool call, which is exactly the shape whose re-appended chunks
// would duplicate text / corrupt tool-call JSON on a naive replay.
const init: AgentSdkMessage = {
  type: 'system',
  subtype: 'init',
  session_id: 'sess-abc',
  model: 'claude-opus-4-6',
  tools: ['Bash', 'Read'],
  cwd: '/tmp',
}

const usage = {
  input_tokens: 100,
  output_tokens: 50,
  cache_read_input_tokens: 10,
  cache_creation_input_tokens: 5,
}

const resultSuccess: AgentSdkMessage = {
  type: 'result',
  subtype: 'success',
  result: 'done',
  usage,
  total_cost_usd: 0.12,
}

function fixtureMessages(): Array<AgentSdkMessage> {
  return [
    init,
    {
      type: 'assistant',
      message: {
        id: 'msg-1',
        content: [
          {
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Bash',
            input: { command: 'ls' },
          },
        ],
      },
      parent_tool_use_id: null,
    },
    {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: 'toolu_1',
            content: 'file-a\nfile-b',
          },
        ],
      },
      parent_tool_use_id: null,
    },
    {
      type: 'assistant',
      message: {
        id: 'msg-2',
        content: [{ type: 'text', text: 'Found two files.' }],
      },
      parent_tool_use_id: null,
    },
    resultSuccess,
  ]
}

describe('translateSdkStream journaled-path determinism', () => {
  it('re-translating the same journal bytes with fresh run-scoped id generators produces identical fingerprints', async () => {
    const runId = 'run-determinism-1'

    const first = await translate(
      fixtureMessages(),
      runId,
      createRunScopedIdGen(runId),
    )
    const second = await translate(
      fixtureMessages(),
      runId,
      createRunScopedIdGen(runId),
    )

    expect(first.length).toBeGreaterThan(0)
    expect(first.map(chunkFingerprint)).toEqual(second.map(chunkFingerprint))
  })

  it('teeth check: a non-run-scoped (random) genId makes the two translations diverge', async () => {
    const runId = 'run-determinism-2'
    const randomGenId = () =>
      `${runId}-${Date.now()}-${Math.random().toString(36).slice(2)}`

    const first = await translate(fixtureMessages(), runId, randomGenId)
    const second = await translate(fixtureMessages(), runId, randomGenId)

    expect(first.length).toBeGreaterThan(0)
    expect(first.map(chunkFingerprint)).not.toEqual(
      second.map(chunkFingerprint),
    )
  })
})
