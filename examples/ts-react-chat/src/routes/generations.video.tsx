import { useEffect, useRef, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { Film, Loader2, Shuffle, Upload, Wand2, X } from 'lucide-react'
import { useGenerateVideo } from '@tanstack/ai-react'
import { fetchServerSentEvents } from '@tanstack/ai-client'
import { VIDEO_MODEL_GROUPS } from '@/lib/models'
import { GroupedModelSelect } from '@/components/ModelSelect'
import { getRandomVideoPrompt } from '@/lib/prompts'
import { imageUrlToPart, readMediaFile, toVideoPart } from '@/lib/media'
import {
  generationRunPersistence,
  rememberRunLabel,
  rememberRunPreview,
} from '../lib/generation-runs'
import { GenerationRunHistory } from '../components/GenerationRunHistory'
import type { VideoGenerateResult } from '@tanstack/ai-client'
import type { MediaPrompt, MediaPromptPart } from '@tanstack/ai/client'
import type { VideoModel, VideoModelId, VideoMode } from '@/lib/models'
import type { AttachedMedia } from '@/lib/media'

// Each model card persists its lightweight resume snapshot across reloads
// under its own hook id (`video:<model id>`) and records finished runs into
// the shared history list rendered below the form. For a long video run this
// keeps the job id around after a reload.
const videoPersistence = generationRunPersistence('video')

// Capture the generated video's URL so clicking the history entry can play it.
function recordVideoPreview(result: VideoGenerateResult) {
  rememberRunPreview('video', [{ type: 'video', src: result.url }])
}

interface VideoRunRequest {
  /** Incremented on every Generate click, so re-runs with an unchanged prompt still trigger. */
  key: number
  prompt: string
  mode: VideoMode
  /** data: URL of the start frame (image-to-video only). */
  sourceImage: string | null
}

/**
 * One model's video generation card. The hook drives the whole lifecycle over
 * SSE (submit → server-side polling → progress → result); the parent only
 * tells the card *when* to run via the `run` request.
 */
function VideoModelCard({
  model,
  run,
  attachedVideo,
  showName,
  resetCounter,
  onBusyChange,
}: {
  model: VideoModel
  run: VideoRunRequest | null
  /** Reference clip / video to edit — Gemini Omni Flash only. */
  attachedVideo: AttachedMedia | null
  showName: boolean
  /** Bumped by the parent's "Generate another" — clears this card. */
  resetCounter: number
  onBusyChange: (modelId: VideoModelId, busy: boolean) => void
}) {
  const [editPrompt, setEditPrompt] = useState('')
  const {
    generate,
    result,
    jobId,
    videoStatus,
    isLoading,
    error,
    stop,
    reset,
  } = useGenerateVideo({
    id: `video:${model.id}`,
    connection: fetchServerSentEvents('/api/generate/video'),
    body: { model: model.id },
    persistence: videoPersistence,
    onResult: (r) => {
      recordVideoPreview(r)
      onBusyChange(model.id, false)
    },
    onError: () => onBusyChange(model.id, false),
  })

  const lastRunKey = useRef(0)
  useEffect(() => {
    if (!run || run.key === lastRunKey.current) return
    lastRunKey.current = run.key
    const parts: Array<MediaPromptPart> = [
      { type: 'text', content: run.prompt },
    ]
    // Image-to-video sends the start frame as a prompt part — the fal
    // adapter routes `role: 'start_frame'` to the endpoint's start-image
    // field (e.g. `image_url` on Kling i2v); Omni takes it as an
    // interaction content block.
    if (run.mode === 'image-to-video' && run.sourceImage) {
      parts.push(imageUrlToPart(run.sourceImage, { role: 'start_frame' }))
    }
    // Video prompt parts (reference clip / video to edit) are an Omni
    // capability only — never send them to the other providers.
    if (attachedVideo && model.provider === 'google') {
      parts.push(toVideoPart(attachedVideo))
    }
    const prompt: MediaPrompt = parts.length === 1 ? run.prompt : parts
    onBusyChange(model.id, true)
    void generate({ prompt })
  }, [run, attachedVideo, generate, model.id, model.provider, onBusyChange])

  const lastResetCounter = useRef(resetCounter)
  useEffect(() => {
    if (resetCounter === lastResetCounter.current) return
    lastResetCounter.current = resetCounter
    reset()
  }, [resetCounter, reset])

  /**
   * Gemini Omni Flash conversational editing: chain a new prompt onto a
   * completed generation via its interaction id (the jobId). The model
   * applies the change while preserving everything else in the video.
   */
  const handleEditVideo = () => {
    const trimmed = editPrompt.trim()
    if (!trimmed || !jobId) return
    setEditPrompt('')
    onBusyChange(model.id, true)
    void generate({
      prompt: trimmed,
      modelOptions: { previous_interaction_id: jobId },
    })
  }

  if (!isLoading && !error && !result) return null

  return (
    <div className="space-y-2">
      {showName && (
        <h4 className="text-sm font-medium text-gray-300">{model.name}</h4>
      )}
      {isLoading && (
        <div className="flex items-center justify-between gap-2 p-4 bg-gray-800 rounded-lg border border-gray-700">
          <div className="flex items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-orange-400" />
            <span className="text-gray-400">
              {!videoStatus
                ? 'Submitting...'
                : videoStatus.status === 'processing'
                  ? `Processing${
                      videoStatus.progress != null
                        ? ` (${videoStatus.progress}%)`
                        : '...'
                    }`
                  : 'Queued...'}
            </span>
          </div>
          <button
            onClick={stop}
            className="px-3 py-1 bg-red-600 hover:bg-red-700 text-white rounded-md text-xs font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
      {isLoading && videoStatus?.progress != null && (
        <div className="w-full bg-gray-700 rounded-full h-2">
          <div
            className="bg-orange-500 h-2 rounded-full transition-all"
            style={{ width: `${videoStatus.progress}%` }}
          />
        </div>
      )}
      {error && (
        <div className="flex items-start justify-between gap-2 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
          <span className="text-sm">{error.message}</span>
          <button
            onClick={reset}
            className="text-red-300 hover:text-red-200"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
      {!isLoading && result && (
        <>
          <div className="rounded-lg overflow-hidden border border-gray-700">
            <video
              src={result.url}
              controls
              autoPlay
              loop
              className="w-full h-auto"
            />
          </div>
          {model.provider === 'google' && (
            <div className="flex gap-2">
              <input
                type="text"
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEditVideo()
                }}
                placeholder="Describe an edit — e.g. 'make it nighttime'..."
                disabled={isLoading}
                className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-transparent disabled:opacity-50"
              />
              <button
                onClick={handleEditVideo}
                disabled={isLoading || !editPrompt.trim()}
                className="px-4 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
              >
                <Wand2 className="w-4 h-4" />
                Edit
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function VideoGenerationPage() {
  const [mode, setMode] = useState<VideoMode>('text-to-video')
  const [prompt, setPrompt] = useState('')
  const [selectedModel, setSelectedModel] = useState<VideoModelId | 'all'>(
    'all',
  )
  const [sourceImage, setSourceImage] = useState<string | null>(null)
  const [attachedVideo, setAttachedVideo] = useState<AttachedMedia | null>(null)
  const [run, setRun] = useState<VideoRunRequest | null>(null)
  const [resetCounter, setResetCounter] = useState(0)
  const [busyModels, setBusyModels] = useState<ReadonlySet<VideoModelId>>(
    new Set(),
  )
  const fileInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)

  const filteredGroups = VIDEO_MODEL_GROUPS.map((group) => ({
    ...group,
    models: group.models.filter((model) => model.mode === mode),
  })).filter((group) => group.models.length > 0)
  const visibleModels = filteredGroups.flatMap((group) => group.models)

  // Gemini Omni Flash additionally accepts video prompt parts (a reference
  // clip or a video to edit). Offer the upload whenever an Omni model is in
  // the running — other providers never receive the video part.
  const omniInRun =
    selectedModel === 'all'
      ? visibleModels.some((model) => model.provider === 'google')
      : selectedModel.startsWith('gemini-omni-flash-preview')

  const isGenerating = busyModels.size > 0

  const handleBusyChange = (modelId: VideoModelId, busy: boolean) => {
    setBusyModels((prev) => {
      const next = new Set(prev)
      if (busy) {
        next.add(modelId)
      } else {
        next.delete(modelId)
      }
      return next
    })
  }

  const handleModeChange = (nextMode: VideoMode) => {
    setMode(nextMode)
    // Model availability differs per mode — fall back to "all".
    setSelectedModel('all')
  }

  const handleImageSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return
    const attached = await readMediaFile(file)
    setSourceImage(attached.dataUrl)
  }

  const handleVideoSelect = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0]
    if (videoInputRef.current) videoInputRef.current.value = ''
    if (!file) return
    setAttachedVideo(await readMediaFile(file))
  }

  const handleGenerate = () => {
    const trimmed = prompt.trim()
    if (!trimmed || isGenerating) return
    if (mode === 'image-to-video' && !sourceImage) return
    rememberRunLabel('video', trimmed)
    setRun((prev) => ({
      key: (prev?.key ?? 0) + 1,
      prompt: trimmed,
      mode,
      sourceImage,
    }))
  }

  const handleReset = () => {
    setRun(null)
    setResetCounter((prev) => prev + 1)
  }

  const shownModels =
    selectedModel === 'all'
      ? visibleModels
      : visibleModels.filter((model) => model.id === selectedModel)

  return (
    <div className="flex flex-col h-[calc(100vh-72px)] bg-gray-900 text-white">
      <div className="border-b border-orange-500/20 bg-gray-800 px-6 py-4">
        <h2 className="text-xl font-semibold">Video Generation</h2>
        <p className="text-sm text-gray-400 mt-1">
          Generate videos across fal.ai, xAI, and Gemini models — pick one, or
          run them all side by side. Generation can take several minutes.
        </p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          <div className="flex gap-2">
            <button
              onClick={() => handleModeChange('text-to-video')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                mode === 'text-to-video'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Text-to-Video
            </button>
            <button
              onClick={() => handleModeChange('image-to-video')}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                mode === 'image-to-video'
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              Image-to-Video
            </button>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Model
              </label>
              <GroupedModelSelect
                groups={filteredGroups}
                value={selectedModel}
                onChange={setSelectedModel}
                includeAll
                disabled={isGenerating}
              />
            </div>

            {mode === 'image-to-video' && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Source Image
                </label>
                {sourceImage ? (
                  <div className="relative">
                    <img
                      src={sourceImage}
                      alt="Source"
                      className="w-full max-h-64 object-contain rounded-lg border border-gray-700"
                    />
                    <button
                      onClick={() => setSourceImage(null)}
                      disabled={isGenerating}
                      className="absolute top-2 right-2 p-1 bg-gray-900/80 hover:bg-gray-800 rounded-full text-white disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full p-8 border-2 border-dashed border-gray-600 hover:border-gray-500 rounded-lg text-gray-400 hover:text-gray-300 transition-colors flex flex-col items-center gap-2"
                  >
                    <Upload className="w-8 h-8" />
                    <span>Click to upload an image</span>
                  </button>
                )}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </div>
            )}

            {omniInRun && (
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Reference video{' '}
                  <span className="text-gray-500 font-normal">
                    (optional — Gemini Omni Flash only, clips of 3s or less)
                  </span>
                </label>
                {attachedVideo ? (
                  <div className="relative">
                    <video
                      src={attachedVideo.dataUrl}
                      controls
                      muted
                      className="w-full max-h-64 rounded-lg border border-gray-700"
                    />
                    <button
                      onClick={() => setAttachedVideo(null)}
                      disabled={isGenerating}
                      className="absolute top-2 right-2 p-1 bg-gray-900/80 hover:bg-gray-800 rounded-full text-white disabled:opacity-50"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => videoInputRef.current?.click()}
                    className="w-full p-6 border-2 border-dashed border-gray-600 hover:border-gray-500 rounded-lg text-gray-400 hover:text-gray-300 transition-colors flex flex-col items-center gap-2"
                  >
                    <Upload className="w-6 h-6" />
                    <span>Click to attach a video clip</span>
                  </button>
                )}
                <input
                  ref={videoInputRef}
                  type="file"
                  accept="video/*"
                  onChange={handleVideoSelect}
                  className="hidden"
                />
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-300">
                  Prompt
                </label>
                <button
                  onClick={() => setPrompt(getRandomVideoPrompt(mode))}
                  disabled={isGenerating}
                  className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-orange-400 hover:text-orange-300 bg-orange-500/10 hover:bg-orange-500/20 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  Shuffle
                </button>
              </div>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder={
                  mode === 'image-to-video'
                    ? 'Describe how you want the image to animate...'
                    : 'Describe the video you want to generate...'
                }
                className="w-full px-4 py-3 bg-gray-800 border border-gray-700 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 focus:border-transparent resize-none"
                rows={3}
                disabled={isGenerating}
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={
                isGenerating ||
                !prompt.trim() ||
                (mode === 'image-to-video' && !sourceImage)
              }
              className="w-full px-6 py-3 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 disabled:cursor-not-allowed text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Film className="w-5 h-5" />
                  Generate Video{selectedModel === 'all' ? 's' : ''}
                </>
              )}
            </button>
          </div>

          <div className="space-y-6">
            {run !== null && shownModels.length > 0 && (
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-medium text-white">
                  {selectedModel === 'all'
                    ? 'Generated Videos'
                    : 'Generated Video'}
                </h3>
                {!isGenerating && (
                  <button
                    onClick={handleReset}
                    className="text-sm text-gray-400 hover:text-white underline"
                  >
                    Generate another
                  </button>
                )}
              </div>
            )}
            {shownModels.map((model) => (
              <VideoModelCard
                key={model.id}
                model={model}
                run={run}
                attachedVideo={attachedVideo}
                showName={selectedModel === 'all'}
                resetCounter={resetCounter}
                onBusyChange={handleBusyChange}
              />
            ))}
          </div>

          <GenerationRunHistory kind="video" />
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/generations/video')({
  component: VideoGenerationPage,
})
