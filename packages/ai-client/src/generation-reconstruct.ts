import type {
  AudioGenerationResult,
  ImageGenerationResult,
  PersistedArtifactRef,
  SummarizationResult,
  TranscriptionResult,
} from '@tanstack/ai'
import type { GenerationRestoredResult } from './generation-types'

/**
 * Per-activity `reconstructResult` mappers. On mount restore the generic
 * `GenerationClient` hands each specialized hook a {@link GenerationRestoredResult}
 * (the metadata that survived persistence plus the durable artifact refs, each
 * carrying its serve `url`); the mapper rebuilds the concrete typed result so
 * `result` repaints as if the run had just finished, with media resolved to the
 * durable serve route rather than the provider's expired link.
 *
 * A mapper returns `null` when the snapshot cannot rebuild a valid result; then
 * `result` stays null while `status` / `error` / `resumeState` still repaint.
 */

/** Output artifact refs of a given media type that carry a durable serve URL. */
function mediaUrls(
  restored: GenerationRestoredResult,
  mediaType: PersistedArtifactRef['source']['mediaType'],
): Array<string> {
  return restored.artifacts
    .filter(
      (a) =>
        a.role === 'output' &&
        a.source.mediaType === mediaType &&
        a.url != null,
    )
    .map((a) => a.url as string)
}

/** image → `{ id, model, images: [{ url }], artifacts }`. */
export function reconstructImageResult(
  restored: GenerationRestoredResult,
): ImageGenerationResult | null {
  const urls = mediaUrls(restored, 'image')
  if (urls.length === 0) return null
  return {
    id: restored.id ?? '',
    model: restored.model ?? '',
    images: urls.map((url) => ({ url })),
    ...(restored.artifacts.length > 0 ? { artifacts: restored.artifacts } : {}),
  }
}

/** audio → `{ id, model, audio: { url }, artifacts }`. */
export function reconstructAudioResult(
  restored: GenerationRestoredResult,
): AudioGenerationResult | null {
  const [url] = mediaUrls(restored, 'audio')
  if (!url) return null
  return {
    id: restored.id ?? '',
    model: restored.model ?? '',
    audio: { url },
    ...(restored.artifacts.length > 0 ? { artifacts: restored.artifacts } : {}),
  }
}

/** transcription → `{ id, model, text, artifacts }`. */
export function reconstructTranscriptionResult(
  restored: GenerationRestoredResult,
): TranscriptionResult | null {
  if (restored.text === undefined) return null
  return {
    id: restored.id ?? '',
    model: restored.model ?? '',
    text: restored.text,
    ...(restored.artifacts.length > 0 ? { artifacts: restored.artifacts } : {}),
  }
}

/** summarize → `{ id, model, summary, usage }` (needs persisted `usage`). */
export function reconstructSummarizeResult(
  restored: GenerationRestoredResult,
): SummarizationResult | null {
  if (restored.text === undefined || restored.usage === undefined) return null
  return {
    id: restored.id ?? '',
    model: restored.model ?? '',
    summary: restored.text,
    usage: restored.usage,
  }
}
