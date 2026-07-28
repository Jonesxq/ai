/**
 * Run lifecycle types — the neutral home for what a "run" is.
 *
 * Shared by `@tanstack/ai-persistence` (which exposes a `runs` store through
 * `withPersistence`) and `@tanstack/ai-sandbox` (whose run driver records run
 * status). Living in core is what lets one `RunRecord` per run be shared by
 * both, instead of each package keeping its own and disagreeing. Same rationale
 * as `LockStore` and `SandboxInstanceStore`.
 */
import type { TokenUsage } from '../../../types'

/** A terminal run status: no further events will be appended. */
export type TerminalRunStatus = 'completed' | 'failed' | 'aborted'

/**
 * Lifecycle status of one run (one agent turn within a conversation).
 *
 * `interrupted` is a human-in-the-loop PAUSE that interrupt-resume continues
 * from — it is deliberately NOT terminal, and must never be conflated with
 * `aborted` (an explicit cancellation).
 */
export type RunStatus = 'running' | 'interrupted' | TerminalRunStatus

const TERMINAL: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'completed',
  'failed',
  'aborted',
])

/** Whether `status` means no further events will be appended. */
export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL.has(status)
}

/** Durable bookkeeping for a single run. */
export interface RunRecord {
  runId: string
  /** Conversation this run belongs to — the `Scope.threadId`. */
  threadId: string
  status: RunStatus
  startedAt: number
  finishedAt?: number
  error?: string
  usage?: TokenUsage
  /**
   * Compound sandbox key this run is bound to, when it ran in a sandbox. Lets a
   * reclaimer find the sandbox to tear down without re-deriving the key.
   */
  sandboxKey?: string
  /** Epoch ms when the last viewer detached; absent while someone is attached. */
  detachedSince?: number
  /** Set by an explicit out-of-band cancel. The driver observes it and stops. */
  cancelRequested?: boolean
}

/** Durable store for run lifecycle records. */
export interface RunStore {
  /**
   * Create a run record, or return the existing one unchanged if `runId` is
   * already present.
   *
   * INVARIANT (idempotency): an existing record is returned **unchanged** and
   * the passed `threadId`/`startedAt`/`status` are ignored. This is what makes
   * resuming a run safe. `status` defaults to `'running'` on first creation.
   */
  createOrResume: (
    input: Pick<RunRecord, 'runId' | 'threadId' | 'startedAt'> & {
      status?: RunStatus
    },
  ) => Promise<RunRecord>
  /**
   * Patch a record's mutable fields.
   *
   * INVARIANT: updating an unknown `runId` is a **no-op** — it must not throw
   * and must not create a record.
   */
  update: (
    runId: string,
    patch: Partial<
      Pick<
        RunRecord,
        | 'status'
        | 'finishedAt'
        | 'error'
        | 'usage'
        | 'sandboxKey'
        | 'detachedSince'
        | 'cancelRequested'
      >
    >,
  ) => Promise<void>
  /** Current record, or null when unknown. */
  get: (runId: string) => Promise<RunRecord | null>
  /**
   * Every run in a conversation, ascending by `startedAt`. OPTIONAL: only
   * needed to render a thread's past agent activity. Consumers feature-detect.
   */
  listByThread?: (threadId: string) => Promise<Array<RunRecord>>
  /**
   * Runs that are still `running`, have been detached since before
   * `now - ttlMs`, and may therefore be reclaimed. OPTIONAL: only needed by a
   * reaper. Consumers feature-detect.
   */
  listReclaimable?: (opts: {
    now: number
    ttlMs: number
  }) => Promise<Array<RunRecord>>
  /**
   * The most recent `'running'` run for `threadId`, or `null` if none is active.
   *
   * OPTIONAL — callers feature-detect it (`store.findActiveRun?.(threadId)`) and
   * degrade to "no active run" when a backend has not implemented it.
   *
   * This resolves "does this thread have a live run to attach to?" from the
   * STABLE thread id, which is the durable basis for reconnecting a client (a
   * reload, or the same thread opened on another device) — independent of the
   * ephemeral run id, which a single turn may mint several of. When more than
   * one run is `'running'`, the one with the greatest `startedAt` wins.
   */
  findActiveRun?: (threadId: string) => Promise<RunRecord | null>
}

/**
 * Type a {@link RunStore} implementation inline: pass the object and get
 * autocomplete plus contract checking with no separate annotation. Mirrors
 * `defineLock` / `defineSandboxInstanceStore`.
 */
export function defineRunStore(store: RunStore): RunStore {
  return store
}

/** In-memory {@link RunStore}. Single process only. */
export class InMemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>()

  createOrResume(
    input: Pick<RunRecord, 'runId' | 'threadId' | 'startedAt'> & {
      status?: RunStatus
    },
  ): Promise<RunRecord> {
    const existing = this.runs.get(input.runId)
    if (existing) return Promise.resolve(existing)
    const record: RunRecord = {
      runId: input.runId,
      threadId: input.threadId,
      status: input.status ?? 'running',
      startedAt: input.startedAt,
    }
    this.runs.set(record.runId, record)
    return Promise.resolve(record)
  }

  update(
    runId: string,
    patch: Partial<
      Pick<
        RunRecord,
        | 'status'
        | 'finishedAt'
        | 'error'
        | 'usage'
        | 'sandboxKey'
        | 'detachedSince'
        | 'cancelRequested'
      >
    >,
  ): Promise<void> {
    const existing = this.runs.get(runId)
    if (existing) this.runs.set(runId, { ...existing, ...patch })
    return Promise.resolve()
  }

  get(runId: string): Promise<RunRecord | null> {
    return Promise.resolve(this.runs.get(runId) ?? null)
  }

  listByThread(threadId: string): Promise<Array<RunRecord>> {
    const matching = [...this.runs.values()]
      .filter((run) => run.threadId === threadId)
      .sort((a, b) => a.startedAt - b.startedAt)
    return Promise.resolve(matching)
  }

  listReclaimable(opts: {
    now: number
    ttlMs: number
  }): Promise<Array<RunRecord>> {
    const cutoff = opts.now - opts.ttlMs
    const matching = [...this.runs.values()].filter(
      (run) =>
        run.status === 'running' &&
        run.detachedSince !== undefined &&
        run.detachedSince <= cutoff,
    )
    return Promise.resolve(matching)
  }

  findActiveRun(threadId: string): Promise<RunRecord | null> {
    let active: RunRecord | null = null
    for (const run of this.runs.values()) {
      if (run.threadId !== threadId || run.status !== 'running') continue
      if (active === null || run.startedAt > active.startedAt) active = run
    }
    return Promise.resolve(active)
  }
}
