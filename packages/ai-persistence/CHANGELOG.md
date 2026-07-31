# @tanstack/ai-persistence

## 0.1.0

### Minor Changes

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - The artifact options for `withGenerationPersistence` are now named
  `ArtifactPersistenceOptions`.

  They were declared as a second `export interface WithPersistenceOptions`, which
  TypeScript merged with the chat middleware's options of the same name. The merge
  was invisible but not harmless: `withPersistence(chat, …)` silently accepted
  `extractArtifacts` / `storageKey` / `allowInputUrl` / `artifactFetch`, and
  `WithGenerationPersistenceOptions` — which extends it — advertised
  `snapshotStreaming` / `snapshotIntervalMs`. Every one of those is a no-op on the
  other middleware, so autocomplete offered options that did nothing.

  `WithPersistenceOptions` keeps its meaning: the chat middleware's options.
  `WithGenerationPersistenceOptions` is unchanged in shape and is still what you
  pass to `withGenerationPersistence`, so only code that named the artifact
  interface directly needs an edit:

  ```diff
  -import type { WithPersistenceOptions } from '@tanstack/ai-persistence'
  -function artifactOptions(): WithPersistenceOptions {
  +import type { ArtifactPersistenceOptions } from '@tanstack/ai-persistence'
  +function artifactOptions(): ArtifactPersistenceOptions {
     return { storageKey: ({ runId, artifactId }) => `media/${runId}/${artifactId}` }
   }
  ```

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - Extend the shared conformance testkit to the generation stores.

  **Migration — every existing adapter must update its conformance call.** The suite now fails loudly on a store that is absent without being declared, so a chat-only adapter that used to pass unchanged will start failing on `generationRuns` / `artifacts` / `blobs`. Declare them absent:

  ```diff
  - runPersistenceConformance('my-adapter', () => makePersistence())
  + runPersistenceConformance('my-adapter', () => makePersistence(), {
  +   skip: ['generationRuns', 'artifacts', 'blobs'],
  + })
  ```

  Drop an entry from `skip` as you implement that store — the suite then holds it to the contract below. Declaring absence is deliberate: a silently skipped store is how an adapter ships a `generationRuns` implementation that was never exercised.

  `runPersistenceConformance` now exercises `generationRuns`, `artifacts`, and `blobs` alongside the four chat state stores, so a hand-rolled generation backend is held to the same gate as a chat one: `createOrResume` idempotency and `findLatestForThread` (latest by `startedAt`, thread-scoped, terminal runs included) on the run store; upsert `save`, `list(runId)` ordering, and `delete` / `deleteForRun` scoping on the artifact store; and byte/metadata round-trips, overwrite, silent absent-key `delete`, and `list` prefix + cursor paging on the blob store. Two invariants that were easy to get wrong and are now checked: `list`'s `prefix` matches **literally and case-sensitively** (a SQL backend using `LIKE` fails on both counts, since SQLite's `LIKE` is case-insensitive for ASCII and treats `%` / `_` as wildcards), and cursor paging visits every key exactly once.

  `examples/ts-react-chat`'s self-contained `node:sqlite` adapter implements all seven stores and runs the full suite; its server-side generation route is backed by that adapter, so generated images survive a dev-server restart.

- [#984](https://github.com/TanStack/ai/pull/984) [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a) - Add per-store typer helpers: `defineMessageStore`, `defineRunStore`,
  `defineInterruptStore`, `defineMetadataStore`.

  Each takes a store implementation and returns it typed against the contract, so
  you get autocomplete and checking on the object literal inline — no separate
  `: MessageStore` return annotation. They compose into `defineAIPersistence`,
  which already infers **exact presence**: a store you define is a defined,
  non-optional, autocompleted key on `persistence.stores`, and accessing a store
  you did not define is a compile error.

  ```ts
  import {
    defineAIPersistence,
    defineMessageStore,
    defineRunStore,
  } from '@tanstack/ai-persistence'

  const persistence = defineAIPersistence({
    stores: {
      messages: defineMessageStore({ loadThread, saveThread }),
      runs: defineRunStore({ createOrResume, update, get, findActiveRun }),
    },
  })

  persistence.stores.runs // RunStore (defined)
  persistence.stores.interrupts // compile error — not provided
  ```

- [#984](https://github.com/TanStack/ai/pull/984) [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a) - Server-authoritative reconnect is now automatic and keyed on the thread, not the run.

  A chat's durable identity is its **thread**; run ids are ephemeral (a single turn
  can span several runs via interrupts or tool continuations), so basing reconnect
  on a client-cached run id goes stale the moment a turn rolls to a new run. This
  moves the whole reconnect story onto the stable thread id, resolved by the server.
  - **`RunStore.findActiveRun(threadId)`** — new optional, feature-detected store
    method returning the most recent `'running'` run for a thread. Implemented by
    the in-memory reference backend and covered by the conformance testkit, so any
    adapter that provides it is held to the same invariants (most-recent-running
    wins, thread-scoped, null when idle).
  - **`reconstructChat` now returns `{ messages, activeRun, interrupts }`** (was a
    bare message array): the stored transcript as UI messages, a cursor to an
    in-flight run if one exists, and any pending human-in-the-loop interrupts (tool
    approvals / waits) plus the run they paused. It reads the active run before the
    transcript so observing "no active run" guarantees the transcript is final
    (closing a finish-window race).
  - **`@tanstack/ai-client` hydrates itself on mount.** In server-authoritative
    mode (`persistence: true`) the client caches no transcript and no run
    pointer: on mount `useChat`/`ChatClient` calls the connection's new
    `hydrate(threadId)` (a JSON GET against the same endpoint), paints the returned
    transcript, and — if a run is in flight — tails it via the existing `joinRun`
    durability replay. A reload and the same thread opened on another device are the
    identical, server-resolved path. No loader, no `initialMessages`, no
    `initialResumeSnapshot`, no app-side fetching required.
  - **Interrupts reconstruct from the server too.** A paused approval (a tool with
    `needsApproval`) is restored from `reconstructChat`'s `interrupts` exactly as a
    persisted resume snapshot would be, so a reload — or another device — re-prompts
    the same approve/reject decision and resumes the run it paused. Previously the
    pending interrupt was only recoverable from client storage, so a fresh client
    showed the paused tool call with no way to resolve it.

  Apps keep the single GET endpoint they already have (durability replay when a
  resume cursor is present, else `reconstructChat`); everything else is handled by
  the hook.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - Add generation persistence, mirroring chat: media generation runs survive a reload or dropped connection, restoring transparently into the normal hook fields, with optional durable storage of the generated bytes.

  **Generation run store (server).** `withGenerationPersistence` records each run in a dedicated `generationRuns` (`GenerationRunStore`) store, keyed by the run's own `runId` (the same AG-UI run id the client sends), with `threadId` the run's scope — it no longer overloads the chat `RunStore`. The record holds the activity/provider/model, lifecycle status, result metadata, and (when byte storage is on) the durable artifact refs. `memoryPersistence()` ships an in-memory `generationRuns` store, and `defineGenerationRunStore` / `defineArtifactStore` / `defineBlobStore` type a custom store inline the way `defineMessageStore` / `defineRunStore` already do.

  **Server-side load (`reconstructGeneration`).** A new `reconstructGeneration(persistence, request, options?)` server helper — the generation parallel of `reconstructChat` — reads a `?runId=` (or `?threadId=`) from the request, authorizes it via an `authorize` callback, and returns `{ resumeSnapshot, activeRun }` JSON so a server-authoritative client restores the last run on mount. Requires the `generationRuns` store. `authorize` is optional at the type level for single-user and prototype routes, but any multi-user deployment must pass it: the run and thread ids arrive from the caller, so identity has to be derived from server-side session state and ownership checked before the helper reads persistence. The same applies to a route that serves artifact bytes by id.

  **Media byte storage (server).** When the backend also provides both an `artifacts` (`ArtifactStore`) and a `blobs` (`BlobStore`) store, `withGenerationPersistence` writes each generated file's bytes to the blob store (key `artifacts/<runId>/<artifactId>`), records an `ArtifactRecord`, and attaches `PersistedArtifactRef`s to the result and the run record. A new `artifactUrl` option stamps a durable app-origin serve URL onto each ref (a new `PersistedArtifactRef.url`) and rewrites the live result's media URL to it, so live and restored results both render media from your own origin instead of the provider's expiring link. Extraction is customizable via `extractArtifacts` / `nameArtifact`; `retrieveArtifact` / `retrieveBlob` (and the shared `artifactBlobKey`) serve the bytes back. Prompt media referenced by **URL** is not downloaded: the URL is caller-supplied, so fetching it server-side would be an SSRF vector, and the bytes are redundant. Opt in per-app with `allowInputUrl` (a predicate, so the check can't be skipped). Every artifact fetch is limited to `http:`/`https:`, timed out (`artifactFetchTimeoutMs`, default 30s) and size-capped (`maxArtifactBytes`, default 100 MiB); input fetches additionally block loopback/private/link-local hosts and refuse redirects. `artifactFetch` injects the `fetch` used, for routing downloads through an egress-restricted proxy. `memoryPersistence()` ships in-memory `artifacts`/`blobs` stores; the generation activities gained `threadId` / `runId` options. `@tanstack/ai-utils` adds `base64ToUint8Array`.

  **Client (transparent restore).** Generation hooks (`useGenerateImage`, `useGenerateVideo`, `useGenerateAudio`, `useGenerateSpeech`, `useGeneration`, `useSummarize`, `useTranscription`, and their Solid/Vue/Svelte/Angular equivalents) take a `persistence` option, and it is boolean — server-driven only, with no client-storage adapter arm: `true` hydrates the last run for a stable `threadId` on mount, and the browser caches nothing. Restore is **invisible**: it repaints the normal `result` / `status` / `error` fields as if the run had just finished, and reports the in-flight run's id as `runId` — there is no `resumeSnapshot` / `resumeState` / `pendingArtifacts` / `resultArtifacts` hook field. If a run is still generating when the connection drops or the page reloads, the client re-attaches to it and finishes it in place (via the connection's `joinRun` durability replay), exactly like `useChat`. With byte storage configured, a restored `result` is rebuilt whole, its media resolved to the durable serve URL and its refs on `result.artifacts`; without it, `status` / `error` restore and `result` stays null. The snapshot never holds the generated bytes and never restarts provider work — generation still only begins on `generate(...)`.

  **`threadId` is required whenever `persistence` is set**, enforced at the type level. It is the generation's _scope_ — a stable, app-chosen name for the slot successive runs fill (`product-123-hero`, `video-9-start-frame`) — not a link to a chat conversation, so a workflow generating media outside any conversation names it just as naturally. It stays optional for ephemeral generations, so existing call sites that do not opt into persistence are unaffected. Persistence keys on `threadId` and nothing else; the legacy `id` is deprecated and typed `never` whenever `threadId` is supplied — pass one scope, not two. Previously the key fell back to `id` and then to a generated id, which silently wrote a different slot on every reload — restoring nothing while orphaning the last record.

  **Choose where bytes land.** `withGenerationPersistence`'s new `storageKey` option maps each artifact to its blob-store key, so generated media can live in your own folder structure instead of the default `artifacts/<runId>/<artifactId>`. Server-side only — a browser-supplied key would be a path-traversal and cross-tenant-write vector. The resolved key is recorded on the new `ArtifactRecord.blobKey` (it is no longer derivable once arbitrary) and reads resolve through `resolveArtifactBlobKey`; records written before the field existed fall back to the default convention, so it is a non-breaking addition.

  `findLatestForThread` is a **required** method on `GenerationRunStore` — a `?threadId=` lookup is the whole mount-time hydration path, so a store that cannot answer it cannot back generation persistence. TypeScript rejects a store that omits it; a JavaScript adapter that ships without it fails at the call, not silently.

  Snapshots arriving from the server are validated with the new `parseGenerationResumeSnapshot` before anything is repainted.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - `GenerationRunStatus` now uses the same vocabulary as chat's `RunStatus`.

  ```diff
  - type GenerationRunStatus = 'running' | 'complete' | 'error' | 'interrupted'
  + type GenerationRunStatus = RunStatus // 'running' | 'completed' | 'failed' | 'interrupted'
  ```

  The two enums described the same four lifecycle states under different names,
  `complete` against `completed` and `error` against `failed`, for no reason
  either one could point at. An adapter storing both kinds of run had to keep two
  status vocabularies straight, and a shared `status` column needed two sets of
  checks. They are now one type, so one column and one check constraint cover both
  tables.

  If you wrote a `GenerationRunStore` against the old names, update the two
  literals your store maps or validates. `running` and `interrupted` are
  unchanged. The conformance suite round-trips both new literals — it writes
  `completed` and then `failed` through `update` and reads each back through
  `get` — so re-running it against your adapter will catch anything missed.

  The client-facing resume-snapshot status is **unchanged**
  (`idle | running | complete | error`). It is a separate vocabulary with its own
  `idle` state, mapped from the store status by `reconstructGeneration`, exactly
  as chat maps `RunStatus` to `ChatClientState`. Nothing on the wire moves.

  Also corrected: `GenerationRunRecord.threadId` was documented as an "optional
  link to the chat conversation that triggered this generation", and typed
  optional to match. It is the slot the run fills, the stable app-chosen key
  `findLatestForThread` hydrates by, and `withGenerationPersistence` refuses to
  start a run without one — so the field is now **required**. A record written
  without a scope could never be found again, which is not a shape worth keeping
  representable.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - `GenerationRunRecord.threadId` is now required.

  ```diff
    interface GenerationRunRecord {
      runId: string
  -   threadId?: string
  +   threadId: string
      …
    }
  ```

  `GenerationRunStore.createOrResume` requires it on its input, and the
  `resumeState` cursor on the hydration payload (`ReconstructedGeneration`,
  `GenerationHydrationResult`) narrows from `{ threadId?: string; runId: string }`
  to `{ threadId: string; runId: string }`.

  **Why.** The optional field described a record no code path could produce and no
  client would accept. `withGenerationPersistence` already refused to start a run
  without a scope, so every record the library writes has one.
  `findLatestForThread` — the only query that hydrates a generation — keys on it,
  so a record without one could be written and then never read back. And the
  client discarded any snapshot that arrived without one.

  That last disagreement was a silent failure: the server legitimately omitted
  `threadId` for a record that had none, and `parseGenerationResumeSnapshot`
  responded by dropping the **entire** snapshot — status, result and error along
  with the cursor — leaving a blank idle panel with no diagnostic while the
  provider kept billing. Making the field required removes the disagreement by
  construction rather than patching one side of it.

  **Migration.** If you wrote a `GenerationRunStore`, make the column non-nullable
  and stop defaulting the field to `null`/`undefined`. The conformance suite now
  asserts `threadId` round-trips exactly and is not mutated by an idempotent
  `createOrResume`, so re-running it against your adapter will catch anything
  missed. Records already stored without a `threadId` were unreachable by
  `findLatestForThread`, so there is nothing to backfill for hydration to work —
  delete them or assign them a scope.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - `withGenerationPersistence` reads `threadId` from the activity instead of
  requiring it twice.

  ```diff
  - generateImage({ threadId, middleware: [withGenerationPersistence(p, { threadId })] })
  + generateImage({ threadId, middleware: [withGenerationPersistence(p)] })
  ```

  **The bug underneath (`@tanstack/ai`).** Four streaming activities spread the
  resolved wire identity over their own options:

  ```diff
  - (resolved) => runGenerateImage({ ...options, ...resolved })
  + (resolved) => runGenerateImage({ ...options, runId: resolved.runId })
  ```

  `streamGenerationResult` mints a thread id for the `RUN_*` chunks when the caller
  passes none, so that spread overwrote the caller's `threadId` with an id known to
  nobody. `generateImage`, `generateAudio`, `generateSpeech`, and
  `generateTranscription` were all affected; `generateVideo` already did this
  correctly. Any middleware reading `ctx.threadId` on those four saw a fabricated
  value it could not tell apart from a real one, which is why persistence ignored
  the context and demanded the option.

  **The option (`@tanstack/ai-persistence`).** `WithGenerationPersistenceOptions.threadId`
  is now optional, and an override rather than the only source. The scope resolves
  to `opts.threadId ?? ctx.threadId`, and a run with neither throws a named error
  at `onStart` instead of being filed somewhere nothing can hydrate it from. Code
  that passes `threadId` to both keeps working unchanged.

  The redundancy was also a trap: passing different values to the activity and the
  middleware silently split one slot in two, with the wire using one id and the
  record filed under the other.

- [#984](https://github.com/TanStack/ai/pull/984) [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a) - Move multi-instance **locks** to `@tanstack/ai` under a dedicated `@tanstack/ai/locks` subpath, and nest persistence agent skills like `ai-core`.
  - **`LockStore` / `InMemoryLockStore` / `LocksCapability` / `getLocks` / `provideLocks` / `withLocks`** live in `@tanstack/ai/locks` (not the main `@tanstack/ai` barrel, and not `@tanstack/ai-persistence`).
  - `@tanstack/ai-sandbox` consumes the core `LocksCapability` token (no local lock re-export).
  - The locks agent skill moves with the code: `ai-core/locks` in `@tanstack/ai`, not `ai-persistence/locks`.
  - Agent skills under `@tanstack/ai-persistence` nest as `skills/ai-persistence/{stores,server,build-*-adapter}/`.
  - Docs: locks guide under advanced middleware.

- [#984](https://github.com/TanStack/ai/pull/984) [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a) - Add server-side persistence for `chat()`: durable thread messages, run records, and interrupts.

  `withPersistence(persistence)` is a chat middleware that stores the conversation transcript, tracks each run's status, and records interrupt state so a paused run (tool approval, client-tool execution, generic interrupt) survives a server restart.

  `@tanstack/ai-persistence` ships the **contract**, not a backend for your database:
  - The four store interfaces — `MessageStore`, `RunStore`, `InterruptStore`, `MetadataStore` — with the invariants the middleware depends on (full-replace `saveThread`, idempotent `createOrResume`, insert-if-absent interrupt `create`, `requestedAt`-ascending listings).
  - The `withPersistence` / `withGenerationPersistence` middleware, plus `composePersistence` to assemble stores that live in different systems.
  - `memoryPersistence()`, an in-process reference backend for dev and tests.
  - `LockStore` / `withLocks` / `InMemoryLockStore` for cross-worker coordination — deliberately **not** a state store, and not composable through `composePersistence`.
  - A shared conformance testkit at `@tanstack/ai-persistence/testkit`. `runPersistenceConformance` exercises every method of every store you provide and fails loudly on a store that is missing without being declared in `skip`.

  Implement the stores against whatever database you already run and hand the result to `withPersistence` — the core never inspects your tables, so the schema stays yours. The [Build Your Own Adapter](https://tanstack.com/ai/latest/docs/persistence/build-your-own-adapter) guide walks through a complete `node:sqlite` backend end to end, and the package ships Agent Skills with worked Drizzle, Prisma, and Cloudflare D1 recipes (`npx @tanstack/intent@latest install`). `examples/ts-react-chat` runs on a self-contained `node:sqlite` adapter built this way and verified by the conformance testkit.

  Resume reconstruction is delegated to the chat engine: persistence records interrupts and gates new input on a thread with pending interrupts, while the engine rebuilds the resume tool state from the resume batch and the interrupt bindings carried in the (server-loaded) message history.

  `reconstructChat(persistence, request)` is a server helper that returns a thread's stored messages as a JSON `Response`, so a server-authoritative client can hydrate its transcript on load from a one-line `GET` handler.

- [#1004](https://github.com/TanStack/ai/pull/1004) [`1120f0f`](https://github.com/TanStack/ai/commit/1120f0f8824262b4fd1d3788e606793158d6ac3c) - `RunStore.findActiveRun` is now **required**. It was optional and
  feature-detected (`store.findActiveRun?.(threadId)`), which meant an adapter that
  had not implemented it was indistinguishable from one reporting "nothing is
  running": `reconstructChat` returned `activeRun: null`, and a client reloading
  mid-generation silently never reconnected to the run still producing. That is a
  production failure the type system was in a position to catch.

  Adapters that already implement `findActiveRun` need no change. Adapters that do
  not will now get a compile error; implement it as "most recent `'running'` run
  for the thread, `null` if none" — in SQL,
  `WHERE thread_id = ? AND status = 'running' ORDER BY started_at DESC LIMIT 1`.
  A backend that genuinely has no run lifecycle should declare
  `ChatTranscriptStores` and omit `runs` entirely rather than stub the method.

  The store-contract evolution policy changes to match: new store methods are
  added as required, and capability tiers are expressed at the store level, not by
  optional methods. The conformance testkit no longer skips its `findActiveRun`
  assertions when the method is absent.

- [#984](https://github.com/TanStack/ai/pull/984) [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a) - Make a mid-stream reload resume the same conversation cleanly.
  - `withPersistence` now persists the pending turn at the start of a run (so a
    reload during generation still shows the user's message), stamps each
    assistant turn with its stream `messageId`, and accepts
    `withPersistence(persistence, { snapshotStreaming: true })` to also persist the
    in-progress reply on a throttled interval (`snapshotIntervalMs`, default
    `1000`) for partial-output durability.
  - `ModelMessage` gains an optional `id`; `modelMessagesToUIMessages` preserves
    it, so a hydrated message keeps the same identity as its live stream.
  - On reload, the chat client rebuilds an in-flight assistant turn from the
    delivery log (replaying from the start and applying the buffered backlog in one
    batch) instead of reconciling against the persisted partial, so the reload
    shows one clean bubble that catches up and continues rather than a frozen or
    duplicated partial.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - Make generation persistence work with server functions and direct connections. Server-driven restore (`persistence: true`) previously only worked with the HTTP adapters (`fetchServerSentEvents` / `fetchHttpStream` and their XHR variants), because they are the only connections that implement the optional `hydrateGeneration(threadId)` and `joinRun(runId)` handlers; with `stream()`, `rpcStream()`, or a plain `fetcher` the option silently no-opped, and a stored snapshot still `running` after a reload left the hook stuck on `generating` forever.

  **Handlers on the lightweight adapters (`@tanstack/ai-client`).** `stream()` and `rpcStream()` take an optional second argument, `StreamConnectionHandlers` (`{ hydrate, hydrateGeneration, joinRun }`), spread onto the returned adapter so server-driven persistence works without an HTTP endpoint — each handler is typically a one-line server-function or RPC call. `ConnectConnectionAdapter` also declares the optional chat `hydrate` handler alongside the generation ones.

  **Handlers as generation options (`@tanstack/ai-client`).** `GenerationClientOptions` (and `VideoGenerationClientOptions`, plus every framework hook's generation options) accept optional `hydrateGeneration` / `joinRun` alongside a `fetcher` — or as a fallback when a connection doesn't carry its own. `persistence: true` now hydrates whenever either source exists; the constructor warning only fires when neither does.

  **Interrupted runs no longer stick on `generating` (`@tanstack/ai-client`).** A restored or hydrated snapshot with `status: 'running'` that no `joinRun` handler can tail is repainted as an interrupted error — an interrupted generation cannot be resumed, only re-run — in both `GenerationClient` and `VideoGenerationClient`.

  **Request-free hydration (`@tanstack/ai-persistence`).** New `getGenerationHydration(persistence, id, { by?: 'threadId' | 'runId' })` returns the plain `{ resumeSnapshot, activeRun }` payload straight from the `generationRuns` store, so a server function can back `hydrateGeneration` without fabricating a `Request`. `reconstructGeneration` now delegates to it; `authorize` stays on the `Request`-based function only, so server-function callers gate on their own session before resolving the id.

  **Server-function run replay (`@tanstack/ai`).** `memoryStream` also accepts an explicit `{ runId, offset? }` init instead of a `Request`, and a new `replayRunStream(durability, offset?)` async generator maps a durability `read` (from the start by default) to a bare `StreamChunk` stream — together they let a streaming server function serve `joinRun` for a run id it received as call data.

### Patch Changes

- Updated dependencies [[`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a), [`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`478a4da`](https://github.com/TanStack/ai/commit/478a4da3756e0de09548f2902da3b45748c27b52), [`347b61b`](https://github.com/TanStack/ai/commit/347b61bc788bb816bbd12287c1a426ca7def00f4), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`7c7aa09`](https://github.com/TanStack/ai/commit/7c7aa09a7402b45e6285ebc78a606131aec3e288), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`4ce7600`](https://github.com/TanStack/ai/commit/4ce7600d5b543d4b7e3bd6d63cdf5ecf91cdeeaa), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5)]:
  - @tanstack/ai@0.43.0
  - @tanstack/ai-utils@0.4.0
