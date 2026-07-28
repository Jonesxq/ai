import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import {
  fetchServerSentEvents,
  localStoragePersistence,
  useGenerateImage,
} from '@tanstack/ai-react'

/**
 * Browser-refresh persistence harness for generation hooks (client half).
 *
 * A `localStoragePersistence` adapter stores the lightweight resume snapshot
 * under `tanstack-ai:generation:<id>`. A full `page.reload()` hydrates the
 * snapshot back into the hook — run status, error, and result metadata survive,
 * while the generated image bytes do not (they are never written). The
 * provider-free endpoint is `/api/generation-persistence`.
 */

const snapshots = localStoragePersistence()
const connection = fetchServerSentEvents('/api/generation-persistence')

export const Route = createFileRoute('/generation-persistence')({
  component: GenerationPersistencePage,
})

function GenerationPersistencePage() {
  const image = useGenerateImage({
    id: 'generation-persistence',
    connection,
    persistence: snapshots,
  })

  // The page is SSR'd; the spec must not click the server-rendered button
  // before React attaches handlers. This flag flips only after hydration.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => setHydrated(true), [])

  return (
    <div style={{ padding: 16 }}>
      <h1>Generation persistence</h1>
      {hydrated ? <div data-testid="hydration-marker" /> : null}
      <button
        data-testid="generate-button"
        disabled={image.isLoading}
        onClick={() =>
          void image.generate({ prompt: 'a lighthouse at dusk' })
        }
      >
        Generate
      </button>
      <button data-testid="reset-button" onClick={() => image.reset()}>
        Reset
      </button>

      <div data-testid="client-status">{image.status}</div>
      <div data-testid="snapshot-status">
        {image.resumeSnapshot?.status ?? 'none'}
      </div>
      <div data-testid="snapshot-result-id">
        {image.resumeSnapshot?.result?.id ?? 'none'}
      </div>
      <div data-testid="snapshot-error">
        {image.resumeSnapshot?.error?.message ?? 'none'}
      </div>

      {image.result?.images.map((img, i) => (
        <img
          key={i}
          data-testid="generated-image"
          alt="generated"
          src={
            img.url ?? (img.b64Json ? `data:image/png;base64,${img.b64Json}` : '')
          }
        />
      ))}
    </div>
  )
}
