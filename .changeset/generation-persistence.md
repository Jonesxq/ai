---
'@tanstack/ai': minor
'@tanstack/ai-utils': minor
'@tanstack/ai-persistence': minor
'@tanstack/ai-client': minor
'@tanstack/ai-event-client': minor
'@tanstack/ai-react': minor
'@tanstack/ai-solid': minor
'@tanstack/ai-vue': minor
'@tanstack/ai-svelte': minor
'@tanstack/ai-angular': minor
---

Add generation persistence: a lightweight client resume snapshot plus optional durable storage of the generated media bytes.

**Generation job store (server).** `withGenerationPersistence` now records each run in a dedicated `jobs` (`GenerationJobStore`) store, keyed by the job's `jobId` (`runId`), with `threadId` only an optional link — it no longer overloads the chat `RunStore`. The record holds the activity/provider/model, lifecycle status, result metadata, and (when byte storage is on) the durable artifact refs. `memoryPersistence()` ships an in-memory `jobs` store, and `defineGenerationJobStore` / `defineArtifactStore` / `defineBlobStore` type a custom store inline the way `defineMessageStore` / `defineRunStore` already do.

**Server-side load (`reconstructGeneration`).** A new `reconstructGeneration(persistence, request, options?)` server helper — the generation parallel of `reconstructChat` — reads a `?jobId=` (or `?threadId=`) from the request, authorizes it via an optional `authorize` callback, and returns `{ resumeSnapshot, activeRun }` JSON so a server-authoritative client can restore the last run on mount. Requires the `jobs` store.

**Media byte storage (server).** When the persistence backend also provides both an `artifacts` (`ArtifactStore`) and a `blobs` (`BlobStore`) store, `withGenerationPersistence` writes each generated file's bytes to the blob store (key `artifacts/<runId>/<artifactId>`), records an `ArtifactRecord`, attaches `PersistedArtifactRef`s to the result and onto the job record, and emits a `generation:artifacts` event so the client records them. Extraction is customizable via `extractArtifacts` / `nameArtifact`; `retrieveArtifact` / `retrieveBlob` (and the shared `artifactBlobKey`) serve the bytes back. `memoryPersistence()` ships in-memory `artifacts`/`blobs` stores; the generation activities gained `threadId` / `runId` options and run their result through middleware result transforms. `@tanstack/ai-utils` adds `base64ToUint8Array`.

Add client-side generation persistence: a lightweight resume snapshot for media generation activities.

Generation hooks (`useGenerateImage`, `useGenerateVideo`, `useGenerateAudio`, `useGenerateSpeech`, `useGeneration`, `useSummarize`, `useTranscription`, and their Solid/Vue/Svelte/Angular equivalents) now accept a `persistence` storage adapter and an `initialResumeSnapshot`, and expose `resumeSnapshot` / `resumeState` (plus `pendingArtifacts` / `resultArtifacts`, populated from the server-side artifact pipeline above when an `artifacts` + `blobs` backend is configured).

As a run streams, the client builds a `GenerationResumeSnapshot` — run identity, status, errors, and result metadata, but **never** the generated media bytes — and writes it to the adapter under the key `generation:<id>`, skipping writes with no material change. On construction the client reads the snapshot back (validated with the new `parseGenerationResumeSnapshot`) unless an explicit `initialResumeSnapshot` seed is provided, so the last run's outcome survives a reload. `stop()` and transport-level failures record terminal snapshots, and `reset()` clears the persisted record. The snapshot never exposes a `resume()` action and never restarts provider work — generation still only begins when `generate(...)` is called.

The `persistence` option reuses the same `ChatStorageAdapter` contract as chat, so the shared `localStoragePersistence` / `sessionStoragePersistence` / `indexedDBPersistence` factories work for generations too — inferred contextually when written inline; a standalone generation store takes an explicit `localStoragePersistence<GenerationResumeSnapshot>()` type argument. This pairs with the existing `withGenerationPersistence` server middleware, which records run status in the shared `RunStore`.
