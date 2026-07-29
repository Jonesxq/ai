import { generateImage, generateVideo } from '@tanstack/ai'
import { falImage, falVideo } from '@tanstack/ai-fal'
import { geminiImage, geminiVideo } from '@tanstack/ai-gemini'
import { grokImage, grokVideo } from '@tanstack/ai-grok'
import { IMAGE_MODELS, VIDEO_MODELS } from './models'
import type { ImageModelId, VideoModelId } from './models'
import type {
  ImagePart,
  MediaInputMetadata,
  MediaPrompt,
  TextPart,
  VideoPart,
} from '@tanstack/ai/client'

/**
 * Server-side media dispatch for the generation endpoints.
 *
 * The client picks a model from the central registry in `lib/models.ts` and
 * the SSE endpoints (`/api/generate/image`, `/api/generate/video`) forward the
 * request here. Each model id maps to one adapter call with the per-model
 * size / modelOptions tuned for that endpoint — model ids arrive as strings
 * off the wire and are validated against the registry before dispatch, so
 * both sides share the single list.
 */

/** A prompt restricted to text — accepted by every (incl. text-only) model. */
type TextPrompt = string | Array<TextPart>
/** A prompt of text + image parts — accepted by image-conditioned models. */
type ImagePrompt = string | Array<TextPart | ImagePart<MediaInputMetadata>>
/** A prompt of text + image + video parts — Gemini Omni Flash accepts all three. */
type OmniPrompt =
  | string
  | Array<
      TextPart | ImagePart<MediaInputMetadata> | VideoPart<MediaInputMetadata>
    >

/** True when the prompt carries text — a non-empty string or any prompt part. */
function hasPromptContent(prompt: MediaPrompt): boolean {
  return typeof prompt === 'string'
    ? prompt.trim().length > 0
    : prompt.length > 0
}

/**
 * Narrows a wire `MediaPrompt` to a text + image prompt for image-conditioned
 * models, throwing on any other part kind (video/audio) so unsupported inputs
 * fail fast rather than being silently dropped.
 */
function asImagePrompt(prompt: MediaPrompt): ImagePrompt {
  if (typeof prompt === 'string') return prompt
  return prompt.map((part) => {
    if (part.type === 'text' || part.type === 'image') return part
    throw new Error(`Unsupported prompt part for image model: ${part.type}`)
  })
}

/**
 * Narrows a wire `MediaPrompt` to a text-only prompt, throwing if any image /
 * video / audio part is present (text-to-image models can't accept inputs).
 */
function asTextPrompt(prompt: MediaPrompt): TextPrompt {
  if (typeof prompt === 'string') return prompt
  return prompt.map((part) => {
    if (part.type === 'text') return part
    throw new Error(
      `Model does not support image inputs (received ${part.type} part)`,
    )
  })
}

/**
 * Narrows a wire `MediaPrompt` for Gemini Omni Flash, which accepts text,
 * image, and video prompt parts (audio would be the only rejected kind).
 */
function asOmniPrompt(prompt: MediaPrompt): OmniPrompt {
  if (typeof prompt === 'string') return prompt
  return prompt.map((part) => {
    if (part.type === 'text' || part.type === 'image' || part.type === 'video')
      return part
    throw new Error(`Unsupported prompt part for Omni Flash: ${part.type}`)
  })
}

/**
 * Like `asImagePrompt`, but additionally requires at least one image part —
 * image-to-video endpoints need a start frame.
 */
function asImageToVideoPrompt(
  prompt: MediaPrompt,
): Array<TextPart | ImagePart<MediaInputMetadata>> {
  const narrowed = asImagePrompt(prompt)
  if (
    typeof narrowed === 'string' ||
    !narrowed.some((part) => part.type === 'image')
  ) {
    throw new Error('Start image is required for image-to-video')
  }
  return narrowed
}

function isImageModelId(model: string): model is ImageModelId {
  return IMAGE_MODELS.some((entry) => entry.id === model)
}

function isVideoModelId(model: string): model is VideoModelId {
  return VIDEO_MODELS.some((entry) => entry.id === model)
}

export interface ImageGenerationRequest {
  prompt: MediaPrompt
  model: string
}

/**
 * Streams an image generation for the requested registry model.
 *
 * NOTE: Use string literals when instantiating adapters to preserve type
 * safety. The fal adapter also accepts any string for the very latest models,
 * which is why new models appear to accept any parameter. Pass size
 * information in modelOptions for the fal adapter instead of size to be sure
 * you are using the correct resolution.
 */
export function streamImageGeneration(data: ImageGenerationRequest) {
  if (!hasPromptContent(data.prompt)) throw new Error('Prompt is required')
  if (!isImageModelId(data.model)) {
    throw new Error(`Unknown image model: ${data.model}`)
  }
  const stream = true as const

  switch (data.model) {
    case 'fal-ai/nano-banana-pro': {
      return generateImage({
        adapter: falImage('fal-ai/nano-banana-pro'),
        prompt: asTextPrompt(data.prompt),
        numberOfImages: 1,
        size: '16:9_4K',
        modelOptions: {
          output_format: 'jpeg',
        },
        stream,
      })
    }
    case 'xai/grok-imagine-image': {
      // NOTE: fal's generated `size` type for this model only offers
      // `16:9_1K` / `16:9_4K`, but the live API rejects those resolutions
      // ("Input should be '1k' or '2k'") — fal's published enum is out of
      // sync with its API, so `'16:9_4K'` type-checks yet 422s at runtime.
      // Pass aspect_ratio via modelOptions and let the endpoint pick its
      // default resolution, which both type-checks and works at runtime.
      return generateImage({
        adapter: falImage('xai/grok-imagine-image'),
        prompt: asTextPrompt(data.prompt),
        numberOfImages: 1,
        modelOptions: { aspect_ratio: '16:9' },
        stream,
      })
    }
    case 'grok-imagine-image': {
      // Direct SpaceXAI Imagine API (XAI_API_KEY) via the native grokImage
      // adapter — no fal in between. The grok-imagine models accept image
      // prompt parts for image-conditioned generation, so we narrow with
      // asImagePrompt. Sizing uses the aspect-ratio template.
      return generateImage({
        adapter: grokImage('grok-imagine-image'),
        prompt: asImagePrompt(data.prompt),
        numberOfImages: 1,
        size: '16:9',
        stream,
      })
    }
    case 'grok-imagine-image-quality': {
      return generateImage({
        adapter: grokImage('grok-imagine-image-quality'),
        prompt: asImagePrompt(data.prompt),
        numberOfImages: 1,
        size: '16:9',
        stream,
      })
    }
    case 'fal-ai/flux-2/klein/9b': {
      // NOTE: Newer models are untyped (at the moment)
      return generateImage({
        adapter: falImage('fal-ai/flux-2/klein/9b'),
        prompt: asTextPrompt(data.prompt),
        numberOfImages: 1,
        size: 'landscape_16_9',
        stream,
      })
    }
    case 'fal-ai/z-image/turbo': {
      return generateImage({
        adapter: falImage('fal-ai/z-image/turbo'),
        prompt: asTextPrompt(data.prompt),
        numberOfImages: 1,
        size: 'landscape_16_9',
        modelOptions: {
          acceleration: 'high',
          enable_prompt_expansion: true,
        },
        stream,
      })
    }
    case 'gemini-3.1-flash-image-preview': {
      return generateImage({
        adapter: geminiImage('gemini-3.1-flash-image-preview'),
        prompt: asImagePrompt(data.prompt),
        numberOfImages: 1,
        size: '16:9_4K',
        stream,
      })
    }
    case 'gemini-3-pro-image-preview': {
      return generateImage({
        adapter: geminiImage('gemini-3-pro-image-preview'),
        prompt: asImagePrompt(data.prompt),
        numberOfImages: 1,
        size: '16:9_4K',
        stream,
      })
    }
    case 'imagen-4.0-ultra-generate-001': {
      return generateImage({
        adapter: geminiImage('imagen-4.0-ultra-generate-001'),
        prompt: asTextPrompt(data.prompt),
        numberOfImages: 1,
        size: '1024x1024',
        stream,
      })
    }
    case 'imagen-4.0-generate-001': {
      return generateImage({
        adapter: geminiImage('imagen-4.0-generate-001'),
        prompt: asTextPrompt(data.prompt),
        numberOfImages: 1,
        size: '1024x1024',
        stream,
      })
    }
    case 'imagen-4.0-fast-generate-001': {
      return generateImage({
        adapter: geminiImage('imagen-4.0-fast-generate-001'),
        prompt: asTextPrompt(data.prompt),
        numberOfImages: 1,
        size: '1024x1024',
        stream,
      })
    }
  }
}

export interface VideoGenerationRequest {
  prompt: MediaPrompt
  model: string
  /**
   * Model-specific options forwarded to the adapter. The video page uses
   * this for Gemini Omni Flash conversational editing
   * (`previous_interaction_id`) and task pinning
   * (`generation_config.video_config.task`).
   */
  modelOptions?: Record<string, any>
}

/**
 * Streams the full lifecycle of a video generation job (create → poll →
 * result) for the requested registry model. Image-to-video models receive
 * the start frame as a prompt part (role: 'start_frame') — the fal adapter
 * routes it to the endpoint's start-image field.
 */
export function streamVideoGeneration(data: VideoGenerationRequest) {
  if (!hasPromptContent(data.prompt)) throw new Error('Prompt is required')
  if (!isVideoModelId(data.model)) {
    throw new Error(`Unknown video model: ${data.model}`)
  }
  const stream = true as const
  const polling = { pollingInterval: 3000, maxDuration: 600_000 } as const

  switch (data.model) {
    // Text-to-video models
    case 'fal-ai/kling-video/v3/pro/text-to-video': {
      return generateVideo({
        adapter: falVideo('fal-ai/kling-video/v3/pro/text-to-video'),
        prompt: asTextPrompt(data.prompt),
        size: '16:9',
        modelOptions: {
          duration: '5',
        },
        stream,
        ...polling,
      })
    }
    case 'fal-ai/veo3.1': {
      // NOTE pass aspect ratio, resolution, and duration in model options
      // This makes use of existing types and avoids type errors
      return generateVideo({
        adapter: falVideo('fal-ai/veo3.1'),
        prompt: asTextPrompt(data.prompt),
        size: '16:9_1080p',
        modelOptions: {
          duration: '4s',
        },
        stream,
        ...polling,
      })
    }
    case 'xai/grok-imagine-video/text-to-video': {
      return generateVideo({
        adapter: falVideo('xai/grok-imagine-video/text-to-video'),
        prompt: asTextPrompt(data.prompt),
        size: '16:9_720p',
        modelOptions: {
          duration: 5,
        },
        stream,
        ...polling,
      })
    }
    case 'grok-imagine-video': {
      // Direct SpaceXAI Imagine API (XAI_API_KEY) — no fal in between. The base
      // grok-imagine-video (v1.0) supports text-to-video; durations are
      // 1-15 integer seconds. Completed jobs report usage.unitsBilled
      // (billed seconds) and usage.cost (exact USD).
      return generateVideo({
        adapter: grokVideo('grok-imagine-video'),
        prompt: asTextPrompt(data.prompt),
        size: '16:9_720p',
        duration: 5,
        stream,
        ...polling,
      })
    }
    case 'fal-ai/ltx-2.3/text-to-video/fast': {
      return generateVideo({
        adapter: falVideo('fal-ai/ltx-2.3/text-to-video/fast'),
        prompt: asTextPrompt(data.prompt),
        size: '16:9_2160p',
        stream,
        ...polling,
      })
    }
    // Image-to-video models
    case 'fal-ai/kling-video/v3/pro/image-to-video': {
      return generateVideo({
        adapter: falVideo('fal-ai/kling-video/v3/pro/image-to-video'),
        prompt: asImageToVideoPrompt(data.prompt),
        modelOptions: {
          generate_audio: true,
          duration: '5',
        },
        stream,
        ...polling,
      })
    }
    case 'fal-ai/veo3.1/image-to-video': {
      return generateVideo({
        adapter: falVideo('fal-ai/veo3.1/image-to-video'),
        prompt: asImageToVideoPrompt(data.prompt),
        size: '16:9_1080p',
        modelOptions: {
          duration: '4s',
        },
        stream,
        ...polling,
      })
    }
    case 'xai/grok-imagine-video/image-to-video': {
      return generateVideo({
        adapter: falVideo('xai/grok-imagine-video/image-to-video'),
        prompt: asImageToVideoPrompt(data.prompt),
        size: '16:9_720p',
        modelOptions: {
          duration: 5,
        },
        stream,
        ...polling,
      })
    }
    case 'grok-imagine-video-1.5/image-to-video': {
      // Direct SpaceXAI Imagine API. The starting frame is supplied as an image
      // prompt part (asImageToVideoPrompt requires one); the grokVideo
      // adapter forwards it to the Imagine endpoint as the start frame.
      return generateVideo({
        adapter: grokVideo('grok-imagine-video-1.5'),
        prompt: asImageToVideoPrompt(data.prompt),
        size: '16:9_720p',
        duration: 5,
        stream,
        ...polling,
      })
    }
    case 'fal-ai/ltx-2.3/image-to-video/fast': {
      return generateVideo({
        adapter: falVideo('fal-ai/ltx-2.3/image-to-video/fast'),
        prompt: asImageToVideoPrompt(data.prompt),
        size: '16:9_2160p',
        stream,
        ...polling,
      })
    }
    // Gemini Omni Flash (Interactions API, GEMINI_API_KEY). One model
    // serves both UI entries; it accepts text, image, AND video prompt
    // parts (sent as interaction content blocks: images, then videos,
    // then text). Clips are 3–10s at 720p; `size` is the output aspect
    // ratio. Passing `previous_interaction_id` (via modelOptions) chains a
    // prompt onto a prior generation for conversational editing.
    case 'gemini-omni-flash-preview':
    case 'gemini-omni-flash-preview/image-to-video': {
      const prompt = asOmniPrompt(data.prompt)
      const previousInteractionId =
        typeof data.modelOptions?.previous_interaction_id === 'string'
          ? data.modelOptions.previous_interaction_id
          : undefined
      if (
        data.model.endsWith('/image-to-video') &&
        !previousInteractionId &&
        (typeof prompt === 'string' ||
          !prompt.some((part) => part.type === 'image'))
      ) {
        throw new Error('Start image is required for image-to-video')
      }
      return generateVideo({
        adapter: geminiVideo('gemini-omni-flash-preview'),
        prompt,
        size: '16:9',
        ...(data.modelOptions ? { modelOptions: data.modelOptions } : {}),
        stream,
        ...polling,
      })
    }
  }
}
