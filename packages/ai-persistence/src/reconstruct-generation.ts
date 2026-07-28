import { validateReconstructGenerationStores } from './types'
import type { AIPersistence, GenerationJobRecord } from './types'

/**
 * The JSON body `reconstructGeneration` returns and a server-authoritative
 * client hydrates from on mount.
 *
 * `resumeSnapshot` mirrors the last generation job for the requested thread (or
 * a specific job id): its terminal/running `status`, the `result` metadata and
 * `error` it recorded, the `activity` it ran, and a `resumeState` cursor
 * (present only while the job is still `running`) the client can use to tail the
 * live generation. `null` when there is no matching job.
 *
 * `activeRun` is `{ runId }` when the resolved job is still `running`, else
 * `null` — the parallel of {@link ReconstructedChat.activeRun}.
 */
export interface ReconstructedGeneration {
  resumeSnapshot: {
    schemaVersion: 1
    resumeState: { threadId?: string; runId: string } | null
    status: 'idle' | 'running' | 'complete' | 'error'
    result?: unknown
    error?: { message: string; code?: string }
    activity?: string
  } | null
  activeRun: { runId: string } | null
}

export interface ReconstructGenerationOptions {
  /** Query parameter carrying the thread id. Defaults to `threadId`. */
  param?: string
  /** Query parameter carrying the job id. Defaults to `jobId`. */
  jobParam?: string
  /**
   * Authorize access to the requested generation before loading it.
   *
   * ⚠️ Without this, any caller who knows or guesses `?threadId=` / `?jobId=`
   * receives the generation's status and result metadata. Multi-user /
   * multi-tenant deployments **must** supply an authorization check (session →
   * owned thread/job) or resolve a validated id in the route.
   *
   * Called with whichever id was supplied — the `jobId` when present, else the
   * `threadId`. Return:
   * - `true` to allow the load
   * - `false` for a default `403` response
   * - a `Response` to return as-is (e.g. `401` with a body)
   */
  authorize?: (
    id: string,
    request: Request,
  ) => boolean | Response | Promise<boolean | Response>
}

/**
 * Map the persisted job status to the client-facing resume-snapshot status.
 * An `interrupted` job surfaces as `error` — the client has no live run to
 * resume, and an interrupted generation produced no usable result.
 */
function snapshotStatus(
  status: GenerationJobRecord['status'],
): 'running' | 'complete' | 'error' {
  switch (status) {
    case 'running':
      return 'running'
    case 'complete':
      return 'complete'
    case 'error':
    case 'interrupted':
      return 'error'
  }
}

function jobToSnapshot(
  job: GenerationJobRecord,
): NonNullable<ReconstructedGeneration['resumeSnapshot']> {
  const status = snapshotStatus(job.status)
  return {
    schemaVersion: 1,
    resumeState:
      status === 'running'
        ? {
            runId: job.jobId,
            ...(job.threadId !== undefined ? { threadId: job.threadId } : {}),
          }
        : null,
    status,
    ...(job.result !== undefined ? { result: job.result } : {}),
    ...(job.error !== undefined ? { error: job.error } : {}),
    ...(job.activity !== undefined ? { activity: job.activity } : {}),
  }
}

function jsonResponse(body: ReconstructedGeneration): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Build the JSON `Response` a server-authoritative client hydrates a generation
 * from on load. Reads a `?jobId=` (preferred) or `?threadId=` from the request
 * query and returns `{ resumeSnapshot, activeRun }`
 * ({@link ReconstructedGeneration}):
 *
 * - Resolves the job by `jobId` via `stores.jobs.get`, else the latest job
 *   linked to `threadId` via the optional `stores.jobs.findLatestForThread`.
 * - `resumeSnapshot` — the job mapped to a client snapshot (status, result,
 *   error, activity, and a `resumeState` cursor while still running), or `null`.
 * - `activeRun` — `{ runId }` when the job is still generating, else `null`.
 *
 * Requires `stores.jobs`. Returns `{ resumeSnapshot: null, activeRun: null }`
 * when no id is supplied or no matching job exists, so the caller never has to
 * special-case a first load.
 *
 * This helper does **not** enforce tenancy by itself. Pass
 * {@link ReconstructGenerationOptions.authorize} (or wrap the call in your own
 * session gate) before exposing it on a public route.
 *
 * ```ts
 * export async function GET(request: Request) {
 *   return reconstructGeneration(persistence, request, {
 *     authorize: async (id, req) => {
 *       const userId = await getSessionUserId(req)
 *       return userId != null && (await userOwnsThread(userId, id))
 *     },
 *   })
 * }
 * ```
 */
export async function reconstructGeneration(
  persistence: AIPersistence,
  request: Request,
  options?: ReconstructGenerationOptions,
): Promise<Response> {
  validateReconstructGenerationStores(persistence)
  const jobStore = persistence.stores.jobs
  if (!jobStore) {
    // validateReconstructGenerationStores already throws; this narrows for TS.
    throw new Error('reconstructGeneration requires stores.jobs.')
  }

  const params = new URL(request.url).searchParams
  const jobParam = options?.jobParam ?? 'jobId'
  const threadParam = options?.param ?? 'threadId'
  const jobId = params.get(jobParam) ?? ''
  const threadId = params.get(threadParam) ?? ''

  const id = jobId || threadId
  if (!id) {
    return jsonResponse({ resumeSnapshot: null, activeRun: null })
  }

  if (options?.authorize) {
    const decision = await options.authorize(id, request)
    if (decision instanceof Response) {
      return decision
    }
    if (!decision) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), {
        status: 403,
        headers: {
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
      })
    }
  }

  const job = jobId
    ? await jobStore.get(jobId)
    : ((await jobStore.findLatestForThread?.(threadId)) ?? null)

  if (!job) {
    return jsonResponse({ resumeSnapshot: null, activeRun: null })
  }

  return jsonResponse({
    resumeSnapshot: jobToSnapshot(job),
    activeRun: job.status === 'running' ? { runId: job.jobId } : null,
  })
}
