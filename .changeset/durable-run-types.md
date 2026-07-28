---
'@tanstack/ai': minor
'@tanstack/ai-persistence': minor
'@tanstack/ai-durable-stream': patch
'@tanstack/ai-sandbox': major
---

One run is now described by one record. Chat persistence and the sandbox run driver both read and write the same `RunRecord`, so they can no longer disagree about the status of a given `runId`.

- **`RunStatus`** (`'running' | 'interrupted' | 'completed' | 'failed' | 'aborted'`), **`TerminalRunStatus`** (`'completed' | 'failed' | 'aborted'`), **`RunRecord`**, **`RunStore`**, **`isTerminalRunStatus`**, **`defineRunStore`**, and **`InMemoryRunStore`** now live in `@tanstack/ai` (`packages/ai/src/activities/chat/middleware/run-store.ts`). A `RunStore` needs `createOrResume` / `update` / `get`; `findActiveRun`, `listByThread`, and `listReclaimable` are optional.
- `@tanstack/ai-persistence` re-exports the same core run types, so its `runs` store is typed against `RunStore` directly. `MemoryRunStore` implements both optional list methods, and the shared conformance testkit covers them, skipping when a backend doesn't implement one.
- `StreamDurability.append` takes an optional `{ offsets }` argument and returns the offsets it wrote. Passing offsets turns the append into an idempotent upsert instead of a blind write.
- `AbortInfo` gains an optional `cancelRequested` field. Nothing populates it yet, this is a type-level placeholder for later work, not a working cancellation signal.

### Breaking: `@tanstack/ai-sandbox`

The package's own run-tracking types are gone in favor of the core ones:

- `RunEventLog`, `InMemoryRunEventLog`, `RunEvent`, and `RunEventLogReadOptions` are removed. If you were reading sandbox run events for Cloudflare, the same event-log implementation now lives in `@tanstack/ai-sandbox-cloudflare`.
- `RunError` is removed along with the package's local `RunRecord`, `RunStatus`, `TerminalRunStatus`, and `isTerminalRunStatus`. Import these from `@tanstack/ai` instead.
- `pipeToRunLog` and `RunController` no longer take an event log. They take `RunDeps: { runs: RunStore; durability: StreamDurability }`.
- `RunController.attach` takes an opaque `fromOffset: string` (from `StreamDurability`) instead of a numeric `fromSeq`, plus an optional abort signal.
- `threadId` is now a required field wherever a run is created or looked up.
- Terminal status names changed to match the shared `TerminalRunStatus`: `done` is now `completed`, `error` is now `failed`, `aborted` stays `aborted`.
