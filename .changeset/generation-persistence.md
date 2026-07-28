---
'@tanstack/ai-client': minor
'@tanstack/ai-react': minor
'@tanstack/ai-solid': minor
'@tanstack/ai-vue': minor
'@tanstack/ai-svelte': minor
'@tanstack/ai-angular': minor
---

Add client-side generation persistence: a lightweight resume snapshot for media generation activities.

Generation hooks (`useGenerateImage`, `useGenerateVideo`, `useGenerateAudio`, `useGenerateSpeech`, `useGeneration`, `useSummarize`, `useTranscription`, and their Solid/Vue/Svelte/Angular equivalents) now accept a `persistence` storage adapter and an `initialResumeSnapshot`, and expose `resumeSnapshot` / `resumeState` (plus `pendingArtifacts` / `resultArtifacts`, which stay empty until the server-side artifact pipeline ships in a follow-up).

As a run streams, the client builds a `GenerationResumeSnapshot` — run identity, status, errors, and result metadata, but **never** the generated media bytes — and writes it to the adapter under the key `generation:<id>`, skipping writes with no material change. On construction the client reads the snapshot back (validated with the new `parseGenerationResumeSnapshot`) unless an explicit `initialResumeSnapshot` seed is provided, so the last run's outcome survives a reload. `stop()` and transport-level failures record terminal snapshots, and `reset()` clears the persisted record. The snapshot never exposes a `resume()` action and never restarts provider work — generation still only begins when `generate(...)` is called.

The `persistence` option reuses the same `ChatStorageAdapter` contract as chat, so the shared `localStoragePersistence` / `sessionStoragePersistence` / `indexedDBPersistence` factories work for generations too. This pairs with the existing `withGenerationPersistence` server middleware, which records run status in the shared `RunStore`.
