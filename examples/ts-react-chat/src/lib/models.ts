/**
 * Central model registry for the example app.
 *
 * Every model selector in the app reads from this file — chat, image, and
 * video pages all derive their options (and their types) from the `as const`
 * lists below, so adding or removing a model is a one-line change here.
 * Model ids stay literal types (`ImageModelId`, `VideoModelId`, …) instead of
 * widening to `string`, which lets the server endpoints and pages
 * exhaustively switch on them.
 *
 * The lists are authored flat (display order, each entry carrying its
 * provider); the `*_MODEL_GROUPS` views group them per provider for the
 * selectors' <optgroup>s.
 */

// =============================================================================
// Chat models (text)
// =============================================================================

export const CHAT_MODEL_OPTIONS = [
  // OpenAI (default: Responses API via `openaiText`)
  { provider: 'openai', model: 'gpt-5.2', label: 'GPT-5.2' },
  {
    provider: 'openai',
    model: 'gpt-5.2',
    label: 'GPT-5.2 (Chat Completions)',
    api: 'chat-completions',
  },
  { provider: 'openai', model: 'gpt-5.2-pro', label: 'GPT-5.2 Pro' },
  { provider: 'openai', model: 'gpt-5.1', label: 'GPT-5.1' },
  { provider: 'openai', model: 'gpt-5', label: 'GPT-5' },
  { provider: 'openai', model: 'gpt-5-mini', label: 'GPT-5 Mini' },
  { provider: 'openai', model: 'gpt-5-nano', label: 'GPT-5 Nano' },
  { provider: 'openai', model: 'gpt-4.1', label: 'GPT-4.1' },
  { provider: 'openai', model: 'gpt-4o', label: 'GPT-4o' },
  { provider: 'openai', model: 'gpt-4o-mini', label: 'GPT-4o Mini' },

  // Anthropic
  { provider: 'anthropic', model: 'claude-opus-4-7', label: 'Claude Opus 4.7' },
  { provider: 'anthropic', model: 'claude-opus-4-6', label: 'Claude Opus 4.6' },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
  },
  {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    label: 'Claude Sonnet 4.5',
  },
  {
    provider: 'anthropic',
    model: 'claude-haiku-4-5',
    label: 'Claude Haiku 4.5',
  },

  // Google (default: stateless `geminiText`; `api: 'interactions'` selects the
  // stateful Interactions API — `@tanstack/ai-gemini/experimental`)
  { provider: 'google', model: 'gemini-3.1-pro-preview', label: '3.1 Pro Preview' },
  {
    provider: 'google',
    model: 'gemini-3.1-flash-lite-preview',
    label: '3.1 Flash Lite Preview',
  },
  { provider: 'google', model: 'gemini-2.5-pro', label: '2.5 Pro' },
  { provider: 'google', model: 'gemini-2.5-flash', label: '2.5 Flash' },
  {
    provider: 'google',
    model: 'gemini-3.1-pro-preview',
    label: '3.1 Pro Preview (Interactions, experimental)',
    api: 'interactions',
  },
  {
    provider: 'google',
    model: 'gemini-3.5-flash',
    label: '3.5 Flash (Interactions, experimental)',
    api: 'interactions',
  },
  {
    provider: 'google',
    model: 'gemini-3-flash-preview',
    label: '3 Flash Preview (Interactions, experimental)',
    api: 'interactions',
  },
  {
    provider: 'google',
    model: 'gemini-3.1-flash-lite-preview',
    label: '3.1 Flash Lite Preview (Interactions, experimental)',
    api: 'interactions',
  },

  // OpenRouter — multi-provider via OpenRouter's unified API
  { provider: 'openrouter', model: 'openai/gpt-5.2', label: 'OpenAI GPT-5.2' },
  { provider: 'openrouter', model: 'openai/gpt-5.1', label: 'OpenAI GPT-5.1' },
  { provider: 'openrouter', model: 'openai/gpt-5', label: 'OpenAI GPT-5' },
  { provider: 'openrouter', model: 'openai/gpt-4o', label: 'OpenAI GPT-4o' },
  {
    provider: 'openrouter',
    model: 'anthropic/claude-opus-4.7',
    label: 'Anthropic Claude Opus 4.7',
  },
  {
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4.6',
    label: 'Anthropic Claude Sonnet 4.6',
  },
  {
    provider: 'openrouter',
    model: 'anthropic/claude-haiku-4.5',
    label: 'Anthropic Claude Haiku 4.5',
  },
  {
    provider: 'openrouter',
    model: 'google/gemini-2.5-pro',
    label: 'Google Gemini 2.5 Pro',
  },
  { provider: 'openrouter', model: 'x-ai/grok-4', label: 'SpaceXAI Grok 4' },
  {
    provider: 'openrouter',
    model: 'meta-llama/llama-3.3-70b-instruct',
    label: 'Meta Llama 3.3 70B (Groq-routed)',
  },

  // Ollama
  { provider: 'ollama', model: 'gpt-oss:20b', label: 'GPT-OSS 20B' },
  { provider: 'ollama', model: 'granite4:3b', label: 'Granite4 3B' },
  { provider: 'ollama', model: 'mistral', label: 'Mistral' },

  // Groq
  { provider: 'groq', model: 'openai/gpt-oss-120b', label: 'GPT-OSS 120B' },
  {
    provider: 'groq',
    model: 'moonshotai/kimi-k2-instruct-0905',
    label: 'Kimi K2 Instruct',
  },
  {
    provider: 'groq',
    model: 'meta-llama/llama-4-maverick-17b-128e-instruct',
    label: 'Llama 4 Maverick',
  },
  { provider: 'groq', model: 'qwen/qwen3-32b', label: 'Qwen3 32B' },

  // SpaceXAI (formerly xAI — SpaceX merged with xAI in Feb 2026 and renamed
  // the combined company SpaceXAI; Grok remains the model/product brand)
  { provider: 'spacexai', model: 'grok-build-0.1', label: 'Grok Build 0.1' },
  { provider: 'spacexai', model: 'grok-4.3', label: 'Grok 4.3' },

  // Bedrock (default Converse API — reaches Claude, Nova, Llama, gpt-oss, …)
  {
    provider: 'bedrock',
    model: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    label: 'Claude Haiku 4.5',
  },
  { provider: 'bedrock', model: 'us.amazon.nova-pro-v1:0', label: 'Nova Pro' },
  {
    provider: 'bedrock',
    model: 'openai.gpt-oss-120b-1:0',
    label: 'GPT-OSS 120B',
  },
] as const

export type ChatModelOption = (typeof CHAT_MODEL_OPTIONS)[number]
export type ChatProvider = ChatModelOption['provider']
export type ChatModelId = ChatModelOption['model']

/**
 * API flavor for providers that expose more than one wire API. Absent means
 * the provider's default (`openaiText` = Responses API, `geminiText` =
 * stateless generateContent).
 */
export type ChatApi = 'responses' | 'chat-completions' | 'interactions'

/** The entry's API flavor, or `undefined` for the provider default. */
export function chatModelApi(option: ChatModelOption): ChatApi | undefined {
  return 'api' in option ? option.api : undefined
}

export const DEFAULT_CHAT_MODEL: ChatModelOption = CHAT_MODEL_OPTIONS[0]

const CHAT_MODEL_GROUP_META: ReadonlyArray<{
  provider: ChatProvider
  label: string
}> = [
  { provider: 'openai', label: 'OpenAI' },
  { provider: 'anthropic', label: 'Anthropic' },
  { provider: 'google', label: 'Google' },
  { provider: 'openrouter', label: 'OpenRouter' },
  { provider: 'ollama', label: 'Ollama' },
  { provider: 'groq', label: 'Groq' },
  { provider: 'spacexai', label: 'SpaceXAI' },
  { provider: 'bedrock', label: 'Bedrock (Converse)' },
]

/** Chat options grouped per provider, in display order, for <optgroup> rendering. */
export const CHAT_MODEL_GROUPS = CHAT_MODEL_GROUP_META.map((meta) => ({
  ...meta,
  models: CHAT_MODEL_OPTIONS.filter(
    (option) => option.provider === meta.provider,
  ),
}))

// =============================================================================
// Image generation models
// =============================================================================

export const IMAGE_MODELS = [
  {
    id: 'fal-ai/nano-banana-pro',
    name: 'Nano Banana Pro (4k)',
    description: 'Fast, high-quality image generation',
    provider: 'fal',
  },
  {
    id: 'xai/grok-imagine-image',
    name: 'Grok Imagine',
    description: 'SpaceXAI highly aesthetic images with prompt enhancement',
    provider: 'fal',
  },
  {
    id: 'fal-ai/flux-2/klein/9b',
    name: 'FLUX.2 Klein 9B',
    description: 'Enhanced realism, crisp text generation',
    provider: 'fal',
  },
  {
    id: 'fal-ai/z-image/turbo',
    name: 'Z-Image Turbo',
    description: 'Super fast 6B parameter model',
    provider: 'fal',
  },
  {
    id: 'gemini-3.1-flash-image-preview',
    name: 'NanoBanana 2 (Gemini 3.1 Flash)',
    description: 'Latest and fastest Gemini native image generation',
    provider: 'google',
  },
  {
    id: 'gemini-3-pro-image-preview',
    name: 'NanoBanana Pro (Gemini 3 Pro)',
    description: 'Higher quality Gemini native image generation',
    provider: 'google',
  },
  {
    id: 'imagen-4.0-ultra-generate-001',
    name: 'Imagen 4.0 Ultra',
    description: 'Best quality Imagen image generation',
    provider: 'google',
  },
  {
    id: 'imagen-4.0-generate-001',
    name: 'Imagen 4.0',
    description: 'High quality Imagen image generation',
    provider: 'google',
  },
  {
    id: 'imagen-4.0-fast-generate-001',
    name: 'Imagen 4.0 Fast',
    description: 'Fast Imagen image generation',
    provider: 'google',
  },
  {
    id: 'grok-imagine-image',
    name: 'Grok Imagine (SpaceXAI Direct)',
    description: 'SpaceXAI Imagine API via the native grokImage adapter',
    provider: 'spacexai',
  },
  {
    id: 'grok-imagine-image-quality',
    name: 'Grok Imagine Quality (SpaceXAI Direct)',
    description: 'Higher-quality SpaceXAI Imagine images via the native adapter',
    provider: 'spacexai',
  },
] as const

export type ImageModel = (typeof IMAGE_MODELS)[number]
export type ImageModelId = ImageModel['id']
export type ImageModelProvider = ImageModel['provider']

const IMAGE_MODEL_GROUP_META: ReadonlyArray<{
  provider: ImageModelProvider
  label: string
}> = [
  { provider: 'fal', label: 'fal.ai' },
  { provider: 'google', label: 'Google' },
  { provider: 'spacexai', label: 'SpaceXAI (direct)' },
]

/** Image models grouped per provider, in display order, for <optgroup> rendering. */
export const IMAGE_MODEL_GROUPS = IMAGE_MODEL_GROUP_META.map((meta) => ({
  ...meta,
  models: IMAGE_MODELS.filter((model) => model.provider === meta.provider),
}))

// =============================================================================
// Video generation models
// =============================================================================

export const VIDEO_MODELS = [
  {
    id: 'fal-ai/kling-video/v3/pro/text-to-video',
    name: 'Kling 3 Pro (Text-to-Video)',
    description: 'High-quality text-to-video generation',
    mode: 'text-to-video',
    provider: 'fal',
  },
  {
    id: 'fal-ai/kling-video/v3/pro/image-to-video',
    name: 'Kling 3 Pro (Image-to-Video)',
    description: 'Animate images with Kling',
    mode: 'image-to-video',
    provider: 'fal',
  },
  {
    id: 'fal-ai/veo3.1',
    name: 'Veo 3.1 (Text-to-Video)',
    description: 'Google Veo text-to-video',
    mode: 'text-to-video',
    provider: 'fal',
  },
  {
    id: 'fal-ai/veo3.1/image-to-video',
    name: 'Veo 3.1 (Image-to-Video)',
    description: 'Google Veo image-to-video',
    mode: 'image-to-video',
    provider: 'fal',
  },
  {
    id: 'xai/grok-imagine-video/text-to-video',
    name: 'Grok Imagine Video (Text-to-Video)',
    description: 'SpaceXAI video generation from text',
    mode: 'text-to-video',
    provider: 'fal',
  },
  {
    id: 'xai/grok-imagine-video/image-to-video',
    name: 'Grok Imagine Video (Image-to-Video)',
    description: 'SpaceXAI animate images to video',
    mode: 'image-to-video',
    provider: 'fal',
  },
  {
    id: 'fal-ai/ltx-2.3/text-to-video/fast',
    name: 'LTX-2.3 Fast (Text-to-Video)',
    description: 'Fast text-to-video generation',
    mode: 'text-to-video',
    provider: 'fal',
  },
  {
    id: 'fal-ai/ltx-2.3/image-to-video/fast',
    name: 'LTX-2.3 Fast (Image-to-Video)',
    description: 'Fast image-to-video animation',
    mode: 'image-to-video',
    provider: 'fal',
  },
  {
    id: 'grok-imagine-video',
    name: 'Grok Imagine Video 1.0 (Text-to-Video)',
    description:
      'SpaceXAI Imagine API via the native grokVideo adapter (v1.0 supports text-to-video)',
    mode: 'text-to-video',
    provider: 'spacexai',
  },
  {
    id: 'grok-imagine-video-1.5/image-to-video',
    name: 'Grok Imagine Video 1.5 (Image-to-Video)',
    description:
      'Animate a starting frame via the native grokVideo adapter (1.5 is image-to-video only)',
    mode: 'image-to-video',
    provider: 'spacexai',
  },
  {
    id: 'gemini-omni-flash-preview',
    name: 'Gemini Omni Flash (Text-to-Video)',
    description:
      'Google multimodal video generation with conversational editing, via the Interactions API (3-10s, 720p)',
    mode: 'text-to-video',
    provider: 'google',
  },
  {
    id: 'gemini-omni-flash-preview/image-to-video',
    name: 'Gemini Omni Flash (Image-to-Video)',
    description:
      'Animate an image with Gemini Omni Flash via the Interactions API',
    mode: 'image-to-video',
    provider: 'google',
  },
] as const

export type VideoModel = (typeof VIDEO_MODELS)[number]
export type VideoModelId = VideoModel['id']
export type VideoModelProvider = VideoModel['provider']
export type VideoMode = VideoModel['mode']

const VIDEO_MODEL_GROUP_META: ReadonlyArray<{
  provider: VideoModelProvider
  label: string
}> = [
  { provider: 'fal', label: 'fal.ai' },
  { provider: 'spacexai', label: 'SpaceXAI (direct)' },
  { provider: 'google', label: 'Google (direct)' },
]

/** Video models grouped per provider, in display order, for <optgroup> rendering. */
export const VIDEO_MODEL_GROUPS = VIDEO_MODEL_GROUP_META.map((meta) => ({
  ...meta,
  models: VIDEO_MODELS.filter((model) => model.provider === meta.provider),
}))

/**
 * Gemini Omni Flash task modes (`generation_config.video_config.task`).
 * Omit to let the model infer the mode from the prompt and attachments.
 */
export type OmniTaskMode =
  | 'text_to_video'
  | 'image_to_video'
  | 'reference_to_video'
  | 'edit'
