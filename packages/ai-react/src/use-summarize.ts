import { useGeneration } from './use-generation'
import type { StreamChunk, SummarizationResult } from '@tanstack/ai'
import type {
  AIDevtoolsDisplayOptions,
  ConnectConnectionAdapter,
  GenerationClientState,
  GenerationFetcher,
  GenerationPendingArtifact,
  GenerationPersistence,
  GenerationResumeSnapshot,
  GenerationResumeState,
  InferGenerationOutputFromReturn,
  SummarizeGenerateInput,
} from '@tanstack/ai-client'
import type { PersistedArtifactRef } from '@tanstack/ai/client'

/**
 * Options for the useSummarize hook.
 *
 * @template TOutput - The output type after optional transform (defaults to SummarizationResult)
 */
export interface UseSummarizeOptions<TOutput = SummarizationResult> {
  /** Connect-based adapter for streaming transport (SSE, HTTP stream, custom) */
  connection?: ConnectConnectionAdapter
  /** Direct async function for summarization */
  fetcher?: GenerationFetcher<SummarizeGenerateInput, SummarizationResult>
  /** Unique identifier for this generation instance */
  id?: string
  /** Additional body parameters to send with connect-based adapter requests */
  body?: Record<string, any>
  /** Display options for TanStack AI Devtools. */
  devtools?: AIDevtoolsDisplayOptions
  /**
   * How this generation persists across reloads.
   * - Omit / `false`: ephemeral, in-memory only.
   * - `true`: server-driven — on mount the client hydrates the last generation
   *   for its `threadId` from the server (needs a connection with a
   *   `hydrateGeneration` handler) and repaints it; it never auto-starts a run.
   * - a storage adapter: client-driven — the lightweight snapshot is cached under
   *   `generation:<id>` as a run streams and read back on mount. Media bytes are
   *   never stored.
   */
  persistence?: boolean | GenerationPersistence
  /** Thread id for this generation, stable across reloads. Server-driven mode (`persistence: true`) hydrates the last generation under this key. Falls back to `id`. */
  threadId?: string
  /** Explicit resume-snapshot seed for apps that manage storage themselves; skips automatic hydration from `persistence`. Later run events merge into it. */
  initialResumeSnapshot?: GenerationResumeSnapshot
  /**
   * Callback when summarization is complete. Can optionally return a transformed value.
   *
   * - Return a non-null value to transform and store it as the result
   * - Return `null` to keep the previous result unchanged
   * - Return nothing (`void`) to store the raw result as-is
   */
  onResult?: (result: SummarizationResult) => TOutput | null | void
  /** Callback when an error occurs */
  onError?: (error: Error) => void
  /** Callback when progress is reported (0-100) */
  onProgress?: (progress: number, message?: string) => void
  /** Callback for each stream chunk (connect-based adapter mode only) */
  onChunk?: (chunk: StreamChunk) => void
}

/**
 * Return type for the useSummarize hook.
 *
 * @template TOutput - The output type (after optional transform)
 */
export interface UseSummarizeReturn<TOutput = SummarizationResult> {
  /** Trigger summarization */
  generate: (input: SummarizeGenerateInput) => Promise<void>
  /** The summarization result, or null */
  result: TOutput | null
  /** Whether summarization is in progress */
  isLoading: boolean
  /** Current error, if any */
  error: Error | undefined
  /** Current state of the generation */
  status: GenerationClientState
  /** Abort the current summarization */
  stop: () => void
  /** Clear result, error, and return to idle */
  reset: () => void
  /** Lightweight generation resume snapshot, if one is available */
  resumeSnapshot: GenerationResumeSnapshot | undefined
  /** Identity of the in-flight run while one is streaming, or null after it ends */
  resumeState: GenerationResumeState | null
  /** Pending persisted artifact refs observed mid-run. Currently always empty: nothing emits `generation:artifacts` until the server-side artifact pipeline ships in a follow-up */
  pendingArtifacts: Array<GenerationPendingArtifact>
  /** Persisted artifact refs from the final result. Currently always empty: results carry no artifacts until the server-side artifact pipeline ships in a follow-up */
  resultArtifacts: Array<PersistedArtifactRef>
}

/**
 * React hook for summarizing text using AI models.
 *
 * @example
 * ```tsx
 * import { useSummarize } from '@tanstack/ai-react'
 * import { fetchServerSentEvents } from '@tanstack/ai-client'
 *
 * function Summarizer() {
 *   const { generate, result, isLoading } = useSummarize({
 *     connection: fetchServerSentEvents('/api/summarize'),
 *   })
 *
 *   return (
 *     <div>
 *       <button onClick={() => generate({
 *         text: 'Long article text...',
 *         style: 'bullet-points',
 *         maxLength: 200,
 *       })}>
 *         Summarize
 *       </button>
 *       {isLoading && <p>Summarizing...</p>}
 *       {result && <p>{result.summary}</p>}
 *     </div>
 *   )
 * }
 * ```
 */
export function useSummarize<TTransformed = void>(
  options: Omit<UseSummarizeOptions, 'onResult'> & {
    onResult?: (result: SummarizationResult) => TTransformed
  },
): UseSummarizeReturn<
  InferGenerationOutputFromReturn<SummarizationResult, TTransformed>
> {
  const devtools = {
    ...options.devtools,
    framework: 'react',
    hookName: 'useSummarize',
    outputKind: 'text' as const,
  }
  const generation = useGeneration<
    SummarizeGenerateInput,
    SummarizationResult,
    TTransformed
  >({
    ...options,
    devtools,
  })

  return generation
}
