/**
 * The "run driver" for the inverted/serverless sandbox model: pump a `chat()`
 * stream into core's two durable seams — a {@link RunStore} for the run's
 * lifecycle record and a {@link StreamDurability} for its event log — so a
 * trigger can return immediately while a durable orchestrator drives the run
 * and clients tail from an opaque offset.
 *
 * The key inversion vs. a classic request/response handler: there is no caller
 * holding the stream open, so nothing to throw an error *back to*. The event log
 * is the only channel — every chunk (including a terminal
 * {@link EventType.RUN_ERROR}) is appended and assigned a resumable offset, and
 * a thrown stream error is recorded as a synthesized `RUN_ERROR` event plus the
 * record's `error` field. Tailing clients therefore always observe failures;
 * {@link pipeToRunLog} never rejects.
 */
import { EventType } from '@tanstack/ai'
import type {
  RunRecord,
  RunStore,
  StreamChunk,
  StreamDurability,
} from '@tanstack/ai'

/** Whether a chunk is the terminal error event the chat engine emits. */
function isRunErrorChunk(
  chunk: StreamChunk,
): chunk is StreamChunk & { message: string; code?: string } {
  return chunk.type === EventType.RUN_ERROR
}

/** Render an unknown thrown value as a stable error message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Build the synthetic RUN_ERROR chunk appended when the stream throws. */
function syntheticRunError(message: string): StreamChunk {
  const chunk: { type: EventType.RUN_ERROR; message: string } = {
    type: EventType.RUN_ERROR,
    message,
  }
  return chunk
}

/** The two durable seams a run driver needs: lifecycle record + event log. */
export interface RunDeps {
  /** Run lifecycle record (status, thread, timings). */
  runs: RunStore
  /** Delivery-durable event log the run's chunks are appended to. */
  durability: StreamDurability
}

export interface PipeToRunLogOptions extends RunDeps {
  runId: string
  threadId: string
  /** Abort consumption mid-stream; the run finishes as `aborted`. */
  signal?: AbortSignal
}

/** Re-read the now-terminal record; the run was just driven, so it must exist. */
async function reread(runs: RunStore, runId: string): Promise<RunRecord> {
  const latest = await runs.get(runId)
  if (!latest) throw new Error(`run: record for "${runId}" vanished mid-run`)
  return latest
}

async function finish(
  runs: RunStore,
  durability: StreamDurability,
  runId: string,
  status: 'completed' | 'failed' | 'aborted',
  error?: string,
): Promise<RunRecord> {
  await runs.update(runId, {
    status,
    finishedAt: Date.now(),
    ...(error !== undefined ? { error } : {}),
  })
  // Terminalize the event log so live readers stop waiting.
  await durability.close()
  return reread(runs, runId)
}

/**
 * Open the run, append every chunk from `stream`, and finish with the right
 * terminal status. Resolves with the final {@link RunRecord} and never rejects:
 * a thrown stream error is surfaced as a `RUN_ERROR` event plus the record's
 * `error`, which is what tailing clients see.
 *
 * - normal completion → `completed`
 * - a `RUN_ERROR` chunk → append it, then `failed`
 * - the stream throws → append a synthesized `RUN_ERROR`, then `failed`
 * - `signal` aborts mid-stream → stop consuming, `aborted`
 */
export async function pipeToRunLog(
  stream: AsyncIterable<StreamChunk>,
  opts: PipeToRunLogOptions,
): Promise<RunRecord> {
  const { runs, durability, runId, threadId, signal } = opts
  await runs.createOrResume({ runId, threadId, startedAt: Date.now() })
  if (signal?.aborted) return finish(runs, durability, runId, 'aborted')

  try {
    for await (const chunk of stream) {
      if (signal?.aborted) return finish(runs, durability, runId, 'aborted')
      await durability.append([chunk])
      if (isRunErrorChunk(chunk)) {
        return finish(runs, durability, runId, 'failed', chunk.message)
      }
    }
  } catch (error) {
    // Detached run: no caller to throw to. Record the failure in the log so
    // tailing clients observe it, then return — do NOT rethrow.
    const message = messageOf(error)
    await durability.append([syntheticRunError(message)])
    return finish(runs, durability, runId, 'failed', message)
  }

  return finish(runs, durability, runId, 'completed')
}

export interface RunControllerStartInput {
  runId: string
  threadId: string
  stream: AsyncIterable<StreamChunk>
  /** Abort consumption mid-stream; the run finishes as `aborted`. */
  signal?: AbortSignal
}

export interface RunHandle {
  runId: string
  /** Resolves with the final record once the run reaches a terminal status. */
  done: Promise<RunRecord>
}

/**
 * Thin orchestration helper over {@link RunDeps}: fire-and-track a run via
 * {@link pipeToRunLog}, tail it from a cursor, and `drain()` all in-flight runs
 * (e.g. inside a `ctx.waitUntil`). Holds no run state of its own beyond the set
 * of currently in-flight `done` promises.
 */
export class RunController {
  private readonly inFlight = new Set<Promise<RunRecord>>()

  constructor(private readonly deps: RunDeps) {}

  /**
   * Kick off `pipeToRunLog` without awaiting it and return the `runId`
   * immediately plus a `done` promise the orchestrator may await or detach.
   */
  start(input: RunControllerStartInput): RunHandle {
    const done = pipeToRunLog(input.stream, {
      ...this.deps,
      runId: input.runId,
      threadId: input.threadId,
      ...(input.signal !== undefined ? { signal: input.signal } : {}),
    })
    this.inFlight.add(done)
    void done.finally(() => this.inFlight.delete(done))
    return { runId: input.runId, done }
  }

  /** Resumable client tail — replay from `fromOffset`, then live-tail. */
  attach(
    fromOffset: string,
    signal?: AbortSignal,
  ): AsyncIterable<{ offset: string; chunk: StreamChunk }> {
    return this.deps.durability.read(fromOffset, signal)
  }

  /** Current run record, or null when the run is unknown. */
  status(runId: string): Promise<RunRecord | null> {
    return this.deps.runs.get(runId)
  }

  /** Await every currently in-flight run's `done` promise. */
  async drain(): Promise<void> {
    await Promise.all([...this.inFlight])
  }
}
