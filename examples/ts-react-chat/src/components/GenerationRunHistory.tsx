import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { clearGenerationRuns, useGenerationRuns } from '../lib/generation-runs'
import type { GenerationKind, GenerationRunEntry } from '../lib/generation-runs'

const KIND_LABELS: Record<GenerationKind, string> = {
  image: 'Image',
  audio: 'Audio',
  speech: 'Speech',
  transcription: 'Transcription',
  summarize: 'Summarize',
  video: 'Video',
}

function formatWhen(at: number): string {
  const elapsed = Date.now() - at
  if (elapsed < 60_000) return 'just now'
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`
  return new Date(at).toLocaleString()
}

function RunOutput({ entry }: { entry: GenerationRunEntry }) {
  const preview = entry.preview ?? []
  const hasMedia = preview.length > 0 || entry.artifacts.length > 0

  return (
    <div
      data-testid="run-output"
      className="space-y-3 border-t border-gray-800 px-4 py-3"
    >
      {entry.label && (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Input
          </p>
          <p className="whitespace-pre-wrap text-sm text-gray-300">
            {entry.label}
          </p>
        </div>
      )}

      {entry.error ? (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Error
          </p>
          <p className="whitespace-pre-wrap text-sm text-red-400">
            {entry.error}
          </p>
        </div>
      ) : (
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-500">
            Output
          </p>
          {entry.text && (
            <p className="whitespace-pre-wrap text-sm text-gray-200">
              {entry.text}
            </p>
          )}
          {preview.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-3">
              {preview.map((item, index) =>
                item.type === 'image' ? (
                  <img
                    key={index}
                    src={item.src}
                    alt={entry.label ?? 'Generated image'}
                    className="max-h-64 max-w-full rounded-md border border-gray-700 object-contain"
                  />
                ) : item.type === 'audio' ? (
                  <audio
                    key={index}
                    src={item.src}
                    controls
                    className="w-full max-w-md"
                  />
                ) : (
                  <video
                    key={index}
                    src={item.src}
                    controls
                    className="max-h-64 w-full max-w-md rounded-md border border-gray-700"
                  />
                ),
              )}
            </div>
          )}
          {entry.artifacts.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {entry.artifacts.map((artifact) =>
                artifact.mimeType.startsWith('image/') ? (
                  <img
                    key={artifact.url}
                    src={artifact.url}
                    alt={artifact.name}
                    className="max-h-64 max-w-full rounded-md border border-gray-700 object-contain"
                  />
                ) : artifact.mimeType.startsWith('audio/') ? (
                  <audio
                    key={artifact.url}
                    src={artifact.url}
                    controls
                    className="w-full max-w-md"
                  />
                ) : artifact.mimeType.startsWith('video/') ? (
                  <video
                    key={artifact.url}
                    src={artifact.url}
                    controls
                    className="max-h-64 w-full max-w-md rounded-md border border-gray-700"
                  />
                ) : (
                  <a
                    key={artifact.url}
                    href={artifact.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-orange-400 underline hover:text-orange-300"
                  >
                    {artifact.name}
                  </a>
                ),
              )}
            </div>
          )}
          {!entry.text && !hasMedia && (
            <p className="text-sm text-gray-500">
              The output wasn't stored — media bytes are never persisted, and
              this run's preview was missing or too large for localStorage. Only
              the run's metadata survives.
            </p>
          )}
        </div>
      )}

      {entry.model && (
        <p className="font-mono text-xs text-gray-600">model: {entry.model}</p>
      )}
    </div>
  )
}

/**
 * The previous-runs list every generation page shows. Entries are recorded by
 * `generationRunPersistence()` (see `lib/generation-runs.ts`) whenever a run
 * finishes or fails, and survive reloads in localStorage. Click an entry to
 * see what was generated: the input, text output, and any media preview the
 * route captured at result time. Pass `kind` to show one activity's runs, or
 * omit it to show everything.
 */
export function GenerationRunHistory({ kind }: { kind?: GenerationKind }) {
  const runs = useGenerationRuns(kind)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  return (
    <section
      data-testid="generation-run-history"
      className="mt-8 rounded-lg border border-gray-800 bg-gray-800/30"
    >
      <header className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
        <h3 className="text-sm font-semibold text-gray-200">
          Previous runs
          {runs.length > 0 && (
            <span className="ml-2 rounded-full bg-gray-700 px-2 py-0.5 text-xs font-medium text-gray-300">
              {runs.length}
            </span>
          )}
        </h3>
        {runs.length > 0 && (
          <button
            type="button"
            onClick={() => clearGenerationRuns(kind)}
            className="text-xs text-gray-500 transition-colors hover:text-gray-300"
          >
            Clear history
          </button>
        )}
      </header>

      {runs.length === 0 ? (
        <p className="px-4 py-4 text-sm text-gray-500">
          No previous runs yet. Every generation on this page is persisted to
          localStorage; finished runs are listed here and survive a reload.
        </p>
      ) : (
        <ul className="divide-y divide-gray-800">
          {runs.map((entry) => {
            const expanded = expandedId === entry.entryId
            return (
              <li key={entry.entryId}>
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => setExpandedId(expanded ? null : entry.entryId)}
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-gray-800/50"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <ChevronRight
                      size={14}
                      className={`shrink-0 text-gray-500 transition-transform ${
                        expanded ? 'rotate-90' : ''
                      }`}
                    />
                    <span
                      className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                        entry.status === 'complete'
                          ? 'bg-emerald-400'
                          : 'bg-red-400'
                      }`}
                    />
                    {!kind && (
                      <span className="shrink-0 rounded bg-gray-700 px-1.5 py-0.5 text-xs font-medium text-gray-300">
                        {KIND_LABELS[entry.kind]}
                      </span>
                    )}
                    <span className="truncate text-gray-200">
                      {entry.label ??
                        entry.text ??
                        (entry.status === 'complete' ? 'Completed' : 'Failed')}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs text-gray-500">
                    {formatWhen(entry.at)}
                  </span>
                </button>
                {expanded && <RunOutput entry={entry} />}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
