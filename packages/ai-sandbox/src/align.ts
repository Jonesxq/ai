/**
 * Replay-from-zero with log alignment: the mechanism that makes a resumed
 * journal read idempotent.
 *
 * A host translates journal bytes 0..1000 and appends the resulting chunks, then
 * dies. A successor re-reads the journal **from byte 0** and re-translates it,
 * producing the same chunks again. This transform reads what is already in the
 * event log, verifies that the replay reproduces it, suppresses that prefix, and
 * passes only the remainder downstream to be appended.
 *
 * Why this shape rather than the offset-upsert the design sketched:
 *
 * - `StreamDurability.append` does not accept caller-supplied offsets, and
 *   `UpsertableStreamDurability.upsert` is deliberately **not** used here:
 *   `memoryStream.upsert` rejects any offset it did not mint itself, and
 *   `durableStream` has no `upsert` at all (its offsets embed a
 *   backend-assigned cursor). The journal path therefore only ever *appends*,
 *   and this function's whole job is deciding where that append starts. Do not
 *   "simplify" it into an `upsert` — the recommended production adapter cannot
 *   accept one.
 * - Even if it could, re-translation is only reproducible because
 *   `createRunScopedIdGen` makes it so. The dedupe boundary therefore has to be
 *   *derived from the log*, not tracked beside it — which also means there is no
 *   window in which a checkpoint and the log can disagree, because the log is
 *   the checkpoint.
 * - The log stays append-only with strictly increasing offsets. That is what
 *   `durableStream`'s backend enforces and what the client's offset de-dup
 *   (`ai-client`'s `seen` set) relies on — the client is NOT tolerant of a
 *   duplicated text or tool-argument delta.
 *
 * Divergence is a bug, not a condition to recover from, so it throws.
 */
import { chunkFingerprint } from './chunk-identity'
import type { InternalLogger } from '@tanstack/ai/adapter-internals'
import type { StreamChunk, StreamDurability } from '@tanstack/ai'

/**
 * The replay produced a different chunk than the log already holds at that
 * index. Means translation stopped being deterministic — a `genId` that is not
 * run-scoped, a translator that consults the clock, or a journal that was
 * rewritten. Fail loud: suppressing the mismatch would deliver a stream whose
 * prefix and suffix disagree about message identity.
 */
export class JournalReplayDivergedError extends Error {
  constructor(
    readonly index: number,
    readonly stored: string,
    readonly replayed: string,
  ) {
    super(
      `journal replay diverged at index ${index}: stored ${stored} but replayed ${replayed}`,
    )
    this.name = 'JournalReplayDivergedError'
  }
}

export interface AlignToStoredLogOptions {
  /** The run's event log. Read from the beginning; never written here. */
  durability: StreamDurability
  /** Optional sink for the alignment summary. */
  logger?: InternalLogger
}

/**
 * Suppress the chunks already present in the event log and yield the rest.
 *
 * The stored prefix is read exactly once, eagerly, before the first replay
 * chunk is pulled. Both halves of that matter:
 *
 * - **Exactly once**, because a second read mid-stream would race the appends
 *   the caller is making downstream of this transform and could classify a
 *   chunk this very run just appended as an already-stored one, dropping it.
 * - **Via `snapshot()`, never `read()`**. `read` *tails*: it returns only when
 *   the log is terminalized with `close()` or the caller aborts. A takeover's
 *   log is open by definition — the host that would have closed it is the host
 *   that died — so `for await (… of read('-1'))` would never finish, and on an
 *   empty log `memoryStream` rejects a from-start join outright once its
 *   first-chunk deadline elapses. `snapshot()` is the bounded read: it resolves
 *   with what is stored right now, including while the log is still open, and
 *   resolves to `[]` for a run with nothing stored.
 */
export async function* alignToStoredLog(
  chunks: AsyncIterable<StreamChunk>,
  options: AlignToStoredLogOptions,
): AsyncIterable<StreamChunk> {
  const entries = await options.durability.snapshot()
  const stored = entries.map((entry) => chunkFingerprint(entry.chunk))

  let index = 0
  for await (const chunk of chunks) {
    const expected = index < stored.length ? stored[index] : undefined
    if (expected === undefined) {
      index += 1
      yield chunk
      continue
    }
    const actual = chunkFingerprint(chunk)
    if (expected !== actual) {
      throw new JournalReplayDivergedError(index, expected, actual)
    }
    index += 1
  }

  if (index < stored.length) {
    // The journal no longer accounts for chunks the log already delivered to the
    // client. Nothing downstream can repair that, and continuing would leave the
    // run's log claiming events its journal cannot reproduce.
    throw new Error(
      `journal replay is shorter than the stored log: replayed ${index} chunk(s) but the log holds ${stored.length}`,
    )
  }
  options.logger?.provider(
    `journal alignment: suppressed ${Math.min(index, stored.length)} stored chunk(s), forwarded ${Math.max(index - stored.length, 0)}`,
    {},
  )
}
