import { useSyncExternalStore } from 'react'
import { localStoragePersistence } from '@tanstack/ai-client'
import type {
  GenerationPersistence,
  GenerationResumeSnapshot,
} from '@tanstack/ai-client'

/**
 * Shared generation persistence + run history for the example app.
 *
 * Every generation route wires its hooks through `generationRunPersistence()`,
 * which does two things:
 *
 * 1. Delegates to the standard `localStoragePersistence()` adapter, so each
 *    hook's last run (status, result metadata, error — never media bytes)
 *    survives a full page reload exactly as the library intends.
 * 2. Watches the snapshots the client writes and, whenever one reaches a
 *    terminal status (`complete` / `error`), appends a compact entry to a
 *    single shared run-history list in localStorage. The `GenerationRunHistory`
 *    component renders that list, so every page shows its previous runs.
 *
 * The library itself only keeps the *last* snapshot per hook id — the history
 * list is plain example-app code layered on top of the storage adapter
 * contract, which is the point: run history is an app concern, and the adapter
 * seam is where you build it.
 */

export type GenerationKind =
  | 'image'
  | 'audio'
  | 'speech'
  | 'transcription'
  | 'summarize'
  | 'video'

export interface GenerationRunArtifact {
  url: string
  name: string
  mimeType: string
}

export interface GenerationRunPreviewItem {
  type: 'image' | 'audio' | 'video'
  src: string
}

export interface GenerationRunEntry {
  entryId: string
  kind: GenerationKind
  /** Epoch millis when the run reached a terminal state. */
  at: number
  status: 'complete' | 'error'
  /** The prompt / input summary captured at generate time, when available. */
  label?: string
  model?: string
  /** Text output (a transcript or summary), when the activity produces text. */
  text?: string
  error?: string
  /** Durable artifact serve URLs, when the server persisted media. */
  artifacts: Array<GenerationRunArtifact>
  /**
   * Lightweight media previews captured at result time (remote URLs or small
   * data: URLs), so clicking a history entry can show what was generated even
   * though snapshots never persist media bytes. Oversized outputs are skipped.
   */
  preview?: Array<GenerationRunPreviewItem>
}

const HISTORY_STORAGE_KEY = 'example:generation-runs'
const MAX_ENTRIES = 30
// Per-item ceiling for stored preview sources. A remote URL is tiny; a data:
// URL for a short audio clip or SVG fits comfortably; a full-size PNG's base64
// does not and is skipped rather than blowing the localStorage quota.
const PREVIEW_SRC_MAX_CHARS = 300_000
const PREVIEW_MAX_ITEMS = 4

// The base adapter every generation hook in this app shares. The client
// namespaces its record under `generation:<hook id>`, so one adapter serves
// every hook as long as each hook passes a stable `id`.
const snapshotStore = localStoragePersistence<GenerationResumeSnapshot>({
  keyPrefix: 'example:',
})

// The most recent input per kind, captured by `rememberRunLabel()` just before
// `generate()` is called. Snapshots never contain the input (only run identity
// and result metadata), so the label rides along out-of-band.
const pendingLabels = new Map<GenerationKind, string>()

// Media previews captured by `rememberRunPreview()` from `onResult` while the
// run is finishing; consumed when the terminal snapshot records the entry.
const pendingPreviews = new Map<
  GenerationKind,
  Array<GenerationRunPreviewItem>
>()

// Last terminal snapshot recorded per hook id, to avoid double-recording when
// the client re-persists an unchanged terminal snapshot.
const recordedSnapshots = new Map<string, string>()

const listeners = new Set<() => void>()
let crossTabListenerAttached = false

const EMPTY_ENTRIES: Array<GenerationRunEntry> = []
let cachedRaw: string | null = null
let cachedEntries: Array<GenerationRunEntry> = EMPTY_ENTRIES
const cachedByKind = new Map<GenerationKind, Array<GenerationRunEntry>>()

function getLocalStorage(): Storage | null {
  const browserGlobals: { localStorage?: Storage } = globalThis
  return browserGlobals.localStorage ?? null
}

function notify(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  if (!crossTabListenerAttached && typeof window !== 'undefined') {
    crossTabListenerAttached = true
    window.addEventListener('storage', (event) => {
      if (event.key === HISTORY_STORAGE_KEY) notify()
    })
  }
  return () => {
    listeners.delete(listener)
  }
}

function isRunEntry(value: unknown): value is GenerationRunEntry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'entryId' in value &&
    typeof value.entryId === 'string' &&
    'kind' in value &&
    typeof value.kind === 'string' &&
    'at' in value &&
    typeof value.at === 'number' &&
    'status' in value &&
    (value.status === 'complete' || value.status === 'error') &&
    'artifacts' in value &&
    Array.isArray(value.artifacts)
  )
}

function readEntries(): Array<GenerationRunEntry> {
  const storage = getLocalStorage()
  if (!storage) return EMPTY_ENTRIES
  let raw: string | null = null
  try {
    raw = storage.getItem(HISTORY_STORAGE_KEY)
  } catch {
    return EMPTY_ENTRIES
  }
  if (raw === null) return EMPTY_ENTRIES
  if (raw === cachedRaw) return cachedEntries
  try {
    const parsed: unknown = JSON.parse(raw)
    cachedEntries = Array.isArray(parsed) ? parsed.filter(isRunEntry) : []
  } catch {
    cachedEntries = []
  }
  cachedRaw = raw
  cachedByKind.clear()
  return cachedEntries
}

function writeEntries(entries: Array<GenerationRunEntry>): void {
  const storage = getLocalStorage()
  if (!storage) return
  // Best-effort with graceful degradation: if the write exceeds the quota,
  // drop previews from all but the newest few entries and retry, then fall
  // back to a shorter, preview-free list before giving up.
  const attempts: Array<Array<GenerationRunEntry>> = [
    entries,
    entries.map((entry, index) =>
      index < 3 || !entry.preview ? entry : { ...entry, preview: undefined },
    ),
    entries.slice(0, 10).map((entry) => ({ ...entry, preview: undefined })),
  ]
  for (const attempt of attempts) {
    try {
      storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(attempt))
      notify()
      return
    } catch {
      continue
    }
  }
}

function entriesForKind(kind: GenerationKind): Array<GenerationRunEntry> {
  const all = readEntries()
  const cached = cachedByKind.get(kind)
  if (cached) return cached
  const filtered = all.filter((entry) => entry.kind === kind)
  cachedByKind.set(kind, filtered)
  return filtered
}

function toRunEntry(
  kind: GenerationKind,
  snapshot: GenerationResumeSnapshot,
): GenerationRunEntry | null {
  if (snapshot.status !== 'complete' && snapshot.status !== 'error') return null

  const artifacts: Array<GenerationRunArtifact> = []
  for (const ref of snapshot.result?.artifacts ??
    snapshot.pendingArtifacts ??
    []) {
    if (ref.role === 'output' && ref.url) {
      artifacts.push({ url: ref.url, name: ref.name, mimeType: ref.mimeType })
    }
  }

  const label = pendingLabels.get(kind)
  // Consume the pending preview: it belongs to this run only. A failed run
  // gets no preview (its onResult never fired for this run's output).
  const preview = pendingPreviews.get(kind)
  pendingPreviews.delete(kind)
  return {
    entryId: `${kind}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    at: Date.now(),
    status: snapshot.status,
    ...(label ? { label } : {}),
    ...(snapshot.result?.model ? { model: snapshot.result.model } : {}),
    ...(snapshot.result?.text ? { text: snapshot.result.text } : {}),
    ...(snapshot.error ? { error: snapshot.error.message } : {}),
    artifacts,
    ...(snapshot.status === 'complete' && preview && preview.length > 0
      ? { preview }
      : {}),
  }
}

function recordTerminalSnapshot(
  kind: GenerationKind,
  hookId: string,
  snapshot: GenerationResumeSnapshot,
): void {
  const entry = toRunEntry(kind, snapshot)
  if (!entry) return
  // The client persists on every observed chunk; a terminal snapshot is
  // written once per run, but guard against identical re-writes anyway.
  const serialized = JSON.stringify({
    status: snapshot.status,
    result: snapshot.result,
    error: snapshot.error,
  })
  if (recordedSnapshots.get(hookId) === serialized) return
  recordedSnapshots.set(hookId, serialized)
  writeEntries([entry, ...readEntries()].slice(0, MAX_ENTRIES))
}

/**
 * A `GenerationPersistence` adapter for one generation kind: standard
 * localStorage snapshot persistence, plus run-history recording. Pass a stable
 * `id` to the hook alongside this adapter so a reload finds the same record.
 */
export function generationRunPersistence(
  kind: GenerationKind,
): GenerationPersistence {
  return {
    getItem: (id) => snapshotStore.getItem(id),
    setItem: (id, snapshot) => {
      recordTerminalSnapshot(kind, id, snapshot)
      return snapshotStore.setItem(id, snapshot)
    },
    removeItem: (id) => snapshotStore.removeItem(id),
  }
}

/**
 * Capture the user's input just before calling `generate()`, so the history
 * entry for the finishing run can show what was asked for. Persisted snapshots
 * deliberately carry no input, so this is the app's job.
 */
export function rememberRunLabel(kind: GenerationKind, label: string): void {
  const trimmed = label.trim()
  if (trimmed) pendingLabels.set(kind, trimmed.slice(0, 200))
  // A new run is starting — a preview left over from an earlier run must not
  // attach to this one.
  pendingPreviews.delete(kind)
}

/**
 * Capture what a finishing run generated, from the hook's `onResult`, so the
 * history entry can show the output when clicked. Only remote http(s) URLs and
 * small data: URLs are kept — a full-size image's base64 would blow the
 * localStorage quota, so oversized items are dropped (the entry then shows
 * metadata only).
 */
export function rememberRunPreview(
  kind: GenerationKind,
  items: Array<GenerationRunPreviewItem>,
): void {
  const usable = items
    .filter(
      (item) =>
        (item.src.startsWith('https://') ||
          item.src.startsWith('http://') ||
          item.src.startsWith('data:')) &&
        item.src.length <= PREVIEW_SRC_MAX_CHARS,
    )
    .slice(0, PREVIEW_MAX_ITEMS)
  if (usable.length > 0) pendingPreviews.set(kind, usable)
}

/** Previous runs, newest first — all kinds, or one kind when given. */
export function useGenerationRuns(
  kind?: GenerationKind,
): Array<GenerationRunEntry> {
  return useSyncExternalStore(
    subscribe,
    () => (kind ? entriesForKind(kind) : readEntries()),
    () => EMPTY_ENTRIES,
  )
}

/** Remove history entries — one kind's, or everything when omitted. */
export function clearGenerationRuns(kind?: GenerationKind): void {
  if (!kind) {
    const storage = getLocalStorage()
    if (!storage) return
    try {
      storage.removeItem(HISTORY_STORAGE_KEY)
    } catch {
      return
    }
    cachedRaw = null
    cachedEntries = EMPTY_ENTRIES
    cachedByKind.clear()
    notify()
    return
  }
  writeEntries(readEntries().filter((entry) => entry.kind !== kind))
}
