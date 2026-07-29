import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useGenerateImage } from '@tanstack/ai-react'
import type { UseGenerateImageReturn } from '@tanstack/ai-react'
import { fetchServerSentEvents } from '@tanstack/ai-client'
import { resolveMediaPrompt } from '@tanstack/ai'
import { generateImageFn, generateImageStreamFn } from '../lib/server-fns'
import {
  generationRunPersistence,
  rememberRunLabel,
  rememberRunPreview,
} from '../lib/generation-runs'
import { GenerationRunHistory } from '../components/GenerationRunHistory'
import type { ImageGenerationResult } from '@tanstack/ai'

// Every variant persists its lightweight resume snapshot (run identity,
// status, errors, result metadata — never image bytes) and records finished
// runs into the shared history list. The client namespaces its record under
// `generation:<id>` and reads it back on mount, repainting the hook's normal
// `status` / `result` / `error` fields so the last run's outcome survives a
// full page reload.
const imagePersistence = generationRunPersistence('image')

// Capture what was generated so clicking the history entry can show it.
// Remote URLs store as-is; base64 payloads become data: URLs but oversized
// ones are dropped by the size guard in `rememberRunPreview`.
function recordImagePreview(result: ImageGenerationResult) {
  rememberRunPreview(
    'image',
    result.images.map((img) => ({
      type: 'image' as const,
      src:
        img.url ?? (img.b64Json ? `data:image/png;base64,${img.b64Json}` : ''),
    })),
  )
}

function StreamingImageGeneration() {
  const [prompt, setPrompt] = useState('')
  const [numberOfImages, setNumberOfImages] = useState(1)

  const hookReturn = useGenerateImage({
    id: 'image:streaming',
    connection: fetchServerSentEvents('/api/generate/image'),
    persistence: imagePersistence,
    onResult: recordImagePreview,
  })

  return (
    <ImageGenerationUI
      {...hookReturn}
      prompt={prompt}
      setPrompt={setPrompt}
      numberOfImages={numberOfImages}
      setNumberOfImages={setNumberOfImages}
    />
  )
}

function DirectImageGeneration() {
  const [prompt, setPrompt] = useState('')
  const [numberOfImages, setNumberOfImages] = useState(1)

  const hookReturn = useGenerateImage({
    id: 'image:direct',
    fetcher: (input) =>
      generateImageFn({
        data: { ...input, prompt: resolveMediaPrompt(input.prompt).text },
      }),
    persistence: imagePersistence,
    onResult: recordImagePreview,
  })

  return (
    <ImageGenerationUI
      {...hookReturn}
      prompt={prompt}
      setPrompt={setPrompt}
      numberOfImages={numberOfImages}
      setNumberOfImages={setNumberOfImages}
    />
  )
}

function ServerFnImageGeneration() {
  const [prompt, setPrompt] = useState('')
  const [numberOfImages, setNumberOfImages] = useState(1)

  const hookReturn = useGenerateImage({
    id: 'image:server-fn',
    fetcher: (input) =>
      generateImageStreamFn({
        data: { ...input, prompt: resolveMediaPrompt(input.prompt).text },
      }),
    persistence: imagePersistence,
    onResult: recordImagePreview,
  })

  return (
    <ImageGenerationUI
      {...hookReturn}
      prompt={prompt}
      setPrompt={setPrompt}
      numberOfImages={numberOfImages}
      setNumberOfImages={setNumberOfImages}
    />
  )
}

function ImageGenerationUI({
  prompt,
  setPrompt,
  numberOfImages,
  setNumberOfImages,
  generate,
  result,
  isLoading,
  error,
  reset,
}: UseGenerateImageReturn & {
  prompt: string
  setPrompt: (v: string) => void
  numberOfImages: number
  setNumberOfImages: (v: number) => void
}) {
  const handleGenerate = () => {
    if (!prompt.trim()) return
    rememberRunLabel('image', prompt)
    generate({ prompt: prompt.trim(), numberOfImages })
  }

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <label className="text-sm text-gray-400">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe the image you want to generate..."
          className="w-full rounded-lg border border-orange-500/20 bg-gray-800/50 px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-orange-500/50 resize-none"
          rows={3}
          disabled={isLoading}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && prompt.trim()) {
              e.preventDefault()
              handleGenerate()
            }
          }}
        />
      </div>

      <div className="space-y-3">
        <label className="text-sm text-gray-400">Number of Images</label>
        <div className="flex gap-2">
          {[1, 2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => setNumberOfImages(n)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                numberOfImages === n
                  ? 'bg-orange-600 text-white'
                  : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-3">
        <button
          onClick={handleGenerate}
          disabled={!prompt.trim() || isLoading}
          className="px-6 py-2 bg-orange-600 hover:bg-orange-700 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
        >
          {isLoading ? 'Generating...' : 'Generate Image'}
        </button>
        {result && (
          <button
            onClick={reset}
            className="px-6 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg">
          <p className="text-red-400 text-sm">{error.message}</p>
        </div>
      )}

      {result && (
        <div className="space-y-4">
          {result.images.map((img, i) => (
            <img
              key={i}
              src={img.url || `data:image/png;base64,${img.b64Json}`}
              alt={img.revisedPrompt || prompt}
              className="w-full rounded-lg border border-gray-700"
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ImageGenerationPage() {
  const [mode, setMode] = useState<'streaming' | 'direct' | 'server-fn'>(
    'streaming',
  )

  return (
    <div className="flex flex-col h-[calc(100vh-72px)] bg-gray-900 text-white">
      <div className="border-b border-orange-500/20 bg-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Image Generation</h2>
            <p className="text-sm text-gray-400 mt-1">
              Generate images using OpenAI's image models
            </p>
          </div>
          <div className="flex gap-1 bg-gray-900/50 rounded-lg p-1">
            <button
              onClick={() => setMode('streaming')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'streaming'
                  ? 'bg-orange-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Streaming
            </button>
            <button
              onClick={() => setMode('direct')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'direct'
                  ? 'bg-orange-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Direct
            </button>
            <button
              onClick={() => setMode('server-fn')}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                mode === 'server-fn'
                  ? 'bg-orange-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Server Fn
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          {mode === 'streaming' ? (
            <StreamingImageGeneration key="streaming" />
          ) : mode === 'direct' ? (
            <DirectImageGeneration key="direct" />
          ) : (
            <ServerFnImageGeneration key="server-fn" />
          )}
          <GenerationRunHistory kind="image" />
        </div>
      </div>
    </div>
  )
}

export const Route = createFileRoute('/generations/image')({
  component: ImageGenerationPage,
})
