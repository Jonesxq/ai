# @tanstack/ai-client

## 0.23.0

### Minor Changes

- [#970](https://github.com/TanStack/ai/pull/970) [`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a) - Adopt the AG-UI interrupt lifecycle for tool approvals, generic responses, and
  client-tool execution, with typed bound resolvers, atomic batches, and
  structured errors. Interrupts run ephemerally by resuming from the full client
  message history in a fresh child run — no persistence required.

  This changes native approval and client-tool streams from legacy custom events
  to snapshot-plus-`RUN_FINISHED` interrupt outcomes. Deprecated
  `pendingInterrupts`, `addToolApprovalResponse`, raw `resumeInterrupts`, and
  legacy event readers remain as limited compatibility surfaces for migration;
  `addToolResult` remains supported.

- [#984](https://github.com/TanStack/ai/pull/984) [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a) - Add browser-refresh durability to the `persistence` option.

  The client `persistence` adapter now stores one combined record per chat id, the message transcript plus a resume snapshot, so a full page reload restores the conversation, rehydrates any pending interrupt, and rejoins a run that was still streaming (via `joinRun`, when the connection is durability-backed). A bare `UIMessage[]` from an older store is still read for backward compatibility.

  **If you hand-rolled a `persistence` adapter, update its write path.** `setItem` now receives the combined `{ messages, resume? }` record where it used to receive a bare `UIMessage[]`, so an adapter that assumed an array will write the new shape and then fail to parse it back — and because adapter reads are best-effort, the failure is silent: the conversation simply does not restore. Read `{ messages, resume? }` in `getItem` (a bare array is still accepted), or switch to the `localStoragePersistence` / `sessionStoragePersistence` / `indexedDBPersistence` adapters below, which handle it for you.

  The `persistence` option also accepts `true` for a server-authoritative chat: the client caches nothing, and on mount it hydrates the thread from the server by its `threadId` (painting the stored transcript and tailing any run still generating). Use it to keep large transcripts off the client while the server stays authoritative for history; it needs a connection with a `hydrate` handler and a server GET endpoint (`reconstructChat`). Passing an adapter is client-authoritative; omitting `persistence` (or `false`) is ephemeral, in-memory only.

  New web storage adapters are exported for this: `localStoragePersistence`, `sessionStoragePersistence`, and `indexedDBPersistence` (plus `StorageUnavailableError` and the `ChatPersistedState` / `ChatStorageAdapter` / `ChatPersistenceOption` types). Because durability rides the existing `persistence` option, every framework integration (`react`, `solid`, `vue`, `svelte`, `angular`, `preact`) gets it with no framework-specific code.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - A restored generation whose result can't be rebuilt now reports an error instead
  of repainting as a blank success.

  Every `reconstructResult` mapper in `generation-reconstruct.ts` (and the video
  client's built-in `reconstructVideoResult`) returns `null` when the persisted
  record lacks what it needs — most commonly an output artifact stored without a
  serve `url`, which is possible because `artifactUrl` is optional server-side.
  `repaintFromSnapshot` silently skipped `setResult` in that case, leaving
  `status: 'success'` with `result: null`: a state no consumer can render, and one
  that hides the real cause.

  When a mapper declines a snapshot whose status is `complete`, the restore now
  settles on `status: 'error'` with an explanatory message and fires `onError`. A
  decline on any other status is still silent — a `running` snapshot has no result
  yet by definition, and the rejoin delivers it. A client with no
  `reconstructResult` mapper at all is unaffected.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - Server-driven generation hydration no longer swallows every failure.

  `GenerationClient` / `VideoGenerationClient` mount hydration
  (`persistence: true`) wrapped the whole `hydrateGeneration` call in a bare
  `try { … } catch { return }`, collapsing a transport error, a `403` from the
  `reconstructGeneration` authorize gate, an unparseable body, and "no record for
  this thread" into one indistinguishable silent no-op — so an app could not tell a
  broken server from a fresh thread, and had no signal to retry.
  - A genuine **miss** (the server reports no record) stays silent, as before.
  - A genuine **failure** now surfaces on `status` / `error` and fires `onError`,
    with a message naming the cause. A record the client's own validator rejects
    (unknown schema version, missing/invalid `status` or `resumeState`) counts as a
    failure, not a miss.
  - The failure is skipped when a `generate()` took ownership of the client while
    the hydrate request was in flight — the live run still wins.

  Relatedly, `fetchServerSentEvents` / `fetchHttpStream` `hydrateGeneration` now
  only treats a `200` carrying `null` as a miss. Any other non-object body (a
  string, an array) rejects instead of being reported as an empty thread, so a
  misconfigured route no longer masquerades as a fresh one.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - A generation stream that ends without a terminal chunk now settles to `error`
  instead of wedging the client on `generating` forever.

  `GenerationClient.processStream` / `VideoGenerationClient.processStream` only
  settled the status on `RUN_FINISHED` or `RUN_ERROR`. A `for await` loop over a
  stream that simply _ends_ — a proxy/load-balancer idle timeout, a server restart
  mid-run, or a durable log whose terminal append never landed — returns normally,
  so no catch fired and the client came to rest on
  `status: 'generating'`, `isLoading: false`, `result: null`, with `onError` never
  called. Worse, the resume snapshot stayed `running`, so every subsequent mount
  rejoined the same dead run and repeated the same outcome.

  Both clients now throw when the stream ends with no terminal chunk seen (and the
  read wasn't aborted by `stop()` / `dispose()`), which routes the failure through
  the existing error path: `status: 'error'`, `error` set, `onError` fired, and the
  resume snapshot rewritten to a terminal `error` with a null `resumeState` so
  nothing chases it again. This applies to both the initial `generate()` path and
  the mount-time `rejoinInFlight` path. A rejoin failure now also fires `onError`,
  matching `generate()`.

  This is the sibling of the earlier "rejoin settles to error" fix, which covered a
  missing and a throwing `joinRun` but not a join that returns cleanly with no
  terminal chunk.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - `localStoragePersistence` / `sessionStoragePersistence` / `indexedDBPersistence`
  default their `TValue` back to `ChatPersistedState` instead of `any`.

  The `any` default was justified by a claim that "a bare call works for both the
  chat **and generation** `persistence` options with no type argument". That is no
  longer true: generation `persistence` is now `boolean` (server-driven only), so
  chat is the sole `persistence` option that takes a storage adapter — and the
  `any` default erased `getItem` / `setItem` type safety for chat users in exchange
  for nothing.

  A bare `localStoragePersistence()` still needs no type argument. Only a
  standalone store holding something other than a chat transcript needs the
  explicit one, e.g. `localStoragePersistence<MyValue>()`.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - Deprecate generation `id` in favor of `threadId` as the single identity.

  `threadId` is the scope for the wire, devtools, and persistence. When it is
  supplied, `id` is typed `never` so you cannot pass both. Legacy `id` remains
  only for ephemeral runs that have no `threadId` (wire/devtools fallback) and is
  marked `@deprecated`.

- [#541](https://github.com/TanStack/ai/pull/541) [`347b61b`](https://github.com/TanStack/ai/commit/347b61bc788bb816bbd12287c1a426ca7def00f4) - **Surface server-side memory state in the TanStack AI DevTools.**

  The DevTools panel now has a **Memory** tab for any chat wired with
  `memoryMiddleware`. It shows, per scope (session), an operations timeline (each
  turn's recall — query, fragment count, injected system-prompt size, whether
  memory tools were exposed, duration) and the current stored records/facts when
  the adapter implements the optional `inspect`/`listFacts` methods.

  Because memory runs on the server (whose event bus never reaches the browser),
  the middleware transports its state to the panel over the chat stream as a
  `memory:state` `CUSTOM` event, which `@tanstack/ai-client`'s devtools bridge
  re-emits as browser `memory:*` events — the same pattern generation results use.
  The snapshot reflects memory as of the start of each turn; opening the panel
  mid-conversation replays the latest state so the tab isn't empty.
  - `@tanstack/ai-memory` — `memoryMiddleware` injects a `memory:state` `CUSTOM`
    chunk carrying recall metrics + an `inspect`/`listFacts` snapshot; exports
    `MEMORY_STATE_EVENT` and `MemoryStateEventValue`.
  - `@tanstack/ai-event-client` — adds the `memory:snapshot` devtools event.
  - `@tanstack/ai-client` — the chat devtools bridge re-emits `memory:*` from the
    transported chunk and replays the last snapshot on `devtools:request-state`.
  - `@tanstack/ai-devtools-core` — new Memory tab + per-scope memory store slice.

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

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - Generation persistence is server-driven only. The hooks' `persistence` option is
  now a boolean.

  ```diff
  - useGenerateImage({ threadId, connection, persistence: localStoragePersistence() })
  + useGenerateImage({ threadId, connection, persistence: true })
  ```

  A generation is one job with one result, not a growing transcript, so a browser
  copy of its record bought nothing that the server record does not already
  provide, and cost a second source of truth to keep in step. Worse, the two modes
  restored differently: a client snapshot can never hold the generated bytes, so
  `result` came back `null` from storage but whole from the server. One mode
  removes that split.

  Gone from `@tanstack/ai-client`: the `GenerationPersistence` type, the storage
  read/write path in `GenerationClient` and `VideoGenerationClient`, and the
  adapter arm of `GenerationPersistenceOption`. `persistence: true` still requires
  a stable `threadId` at the type level, and still needs a `hydrateGeneration`
  handler (every built-in connection has one) plus a `reconstructGeneration` route.

  `initialResumeSnapshot` is unchanged, so an app that wants to manage its own
  storage can still seed the client from it.

  **None of this touches chat.** `useChat` keeps both modes, and
  `localStoragePersistence` / `sessionStoragePersistence` / `indexedDBPersistence`
  are still exported and still work for conversations.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - Add generation persistence, mirroring chat: media generation runs survive a reload or dropped connection, restoring transparently into the normal hook fields, with optional durable storage of the generated bytes.

  **Generation run store (server).** `withGenerationPersistence` records each run in a dedicated `generationRuns` (`GenerationRunStore`) store, keyed by the run's own `runId` (the same AG-UI run id the client sends), with `threadId` the run's scope — it no longer overloads the chat `RunStore`. The record holds the activity/provider/model, lifecycle status, result metadata, and (when byte storage is on) the durable artifact refs. `memoryPersistence()` ships an in-memory `generationRuns` store, and `defineGenerationRunStore` / `defineArtifactStore` / `defineBlobStore` type a custom store inline the way `defineMessageStore` / `defineRunStore` already do.

  **Server-side load (`reconstructGeneration`).** A new `reconstructGeneration(persistence, request, options?)` server helper — the generation parallel of `reconstructChat` — reads a `?runId=` (or `?threadId=`) from the request, authorizes it via an `authorize` callback, and returns `{ resumeSnapshot, activeRun }` JSON so a server-authoritative client restores the last run on mount. Requires the `generationRuns` store. `authorize` is optional at the type level for single-user and prototype routes, but any multi-user deployment must pass it: the run and thread ids arrive from the caller, so identity has to be derived from server-side session state and ownership checked before the helper reads persistence. The same applies to a route that serves artifact bytes by id.

  **Media byte storage (server).** When the backend also provides both an `artifacts` (`ArtifactStore`) and a `blobs` (`BlobStore`) store, `withGenerationPersistence` writes each generated file's bytes to the blob store (key `artifacts/<runId>/<artifactId>`), records an `ArtifactRecord`, and attaches `PersistedArtifactRef`s to the result and the run record. A new `artifactUrl` option stamps a durable app-origin serve URL onto each ref (a new `PersistedArtifactRef.url`) and rewrites the live result's media URL to it, so live and restored results both render media from your own origin instead of the provider's expiring link. Extraction is customizable via `extractArtifacts` / `nameArtifact`; `retrieveArtifact` / `retrieveBlob` (and the shared `artifactBlobKey`) serve the bytes back. Prompt media referenced by **URL** is not downloaded: the URL is caller-supplied, so fetching it server-side would be an SSRF vector, and the bytes are redundant. Opt in per-app with `allowInputUrl` (a predicate, so the check can't be skipped). Every artifact fetch is limited to `http:`/`https:`, timed out (`artifactFetchTimeoutMs`, default 30s) and size-capped (`maxArtifactBytes`, default 100 MiB); input fetches additionally block loopback/private/link-local hosts and refuse redirects. `artifactFetch` injects the `fetch` used, for routing downloads through an egress-restricted proxy. `memoryPersistence()` ships in-memory `artifacts`/`blobs` stores; the generation activities gained `threadId` / `runId` options. `@tanstack/ai-utils` adds `base64ToUint8Array`.

  **Client (transparent restore).** Generation hooks (`useGenerateImage`, `useGenerateVideo`, `useGenerateAudio`, `useGenerateSpeech`, `useGeneration`, `useSummarize`, `useTranscription`, and their Solid/Vue/Svelte/Angular equivalents) take a `persistence` option, and it is boolean — server-driven only, with no client-storage adapter arm: `true` hydrates the last run for a stable `threadId` on mount, and the browser caches nothing. Restore is **invisible**: it repaints the normal `result` / `status` / `error` fields as if the run had just finished, and reports the in-flight run's id as `runId` — there is no `resumeSnapshot` / `resumeState` / `pendingArtifacts` / `resultArtifacts` hook field. If a run is still generating when the connection drops or the page reloads, the client re-attaches to it and finishes it in place (via the connection's `joinRun` durability replay), exactly like `useChat`. With byte storage configured, a restored `result` is rebuilt whole, its media resolved to the durable serve URL and its refs on `result.artifacts`; without it, `status` / `error` restore and `result` stays null. The snapshot never holds the generated bytes and never restarts provider work — generation still only begins on `generate(...)`.

  **`threadId` is required whenever `persistence` is set**, enforced at the type level. It is the generation's _scope_ — a stable, app-chosen name for the slot successive runs fill (`product-123-hero`, `video-9-start-frame`) — not a link to a chat conversation, so a workflow generating media outside any conversation names it just as naturally. It stays optional for ephemeral generations, so existing call sites that do not opt into persistence are unaffected. Persistence keys on `threadId` and nothing else; the legacy `id` is deprecated and typed `never` whenever `threadId` is supplied — pass one scope, not two. Previously the key fell back to `id` and then to a generated id, which silently wrote a different slot on every reload — restoring nothing while orphaning the last record.

  **Choose where bytes land.** `withGenerationPersistence`'s new `storageKey` option maps each artifact to its blob-store key, so generated media can live in your own folder structure instead of the default `artifacts/<runId>/<artifactId>`. Server-side only — a browser-supplied key would be a path-traversal and cross-tenant-write vector. The resolved key is recorded on the new `ArtifactRecord.blobKey` (it is no longer derivable once arbitrary) and reads resolve through `resolveArtifactBlobKey`; records written before the field existed fall back to the default convention, so it is a non-breaking addition.

  `findLatestForThread` is a **required** method on `GenerationRunStore` — a `?threadId=` lookup is the whole mount-time hydration path, so a store that cannot answer it cannot back generation persistence. TypeScript rejects a store that omits it; a JavaScript adapter that ships without it fails at the call, not silently.

  Snapshots arriving from the server are validated with the new `parseGenerationResumeSnapshot` before anything is repainted.

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

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - **Breaking:** the hooks expose `runId` instead of `resumeState`.

  ```diff
  - const { resumeState } = useChat({ threadId, connection })
  - const liveRunId = resumeState?.runId ?? null
  + const { runId } = useChat({ threadId, connection })
  ```

  Every chat hook (`useChat` / `createChat` / `injectChat`) and every generation
  hook (`useGenerateImage`, `useGenerateVideo`, `useGenerateAudio`,
  `useGenerateSpeech`, `useGeneration`, `useSummarize`, `useTranscription` and the
  Solid / Vue / Svelte / Angular equivalents) now returns `runId: string | null` —
  the id of the run streaming right now, or `null` when nothing is in flight.

  `resumeState` was a `{ threadId, runId }` pair whose `threadId` half was always
  the id the caller had just passed in, so the only new information it carried was
  the run id, wrapped in an object that had to be unwrapped and null-checked.
  `runId` is the thing callers actually reach for: the handle you send to your own
  endpoint to cancel or poll a provider job, since `stop()` only aborts the local
  stream and does not stop work already running on the provider.

  On chat it also reports **more** than `resumeState` did. `resumeState` only ever
  held a run that was interrupted or being rejoined, so it stayed `null` through an
  ordinary streaming turn. `runId` tracks every run: it is set when any run starts
  (including a rejoin) and cleared when it settles, backed by the new
  `ChatClient.getCurrentRunId()`.

  `injectChat` (Angular) exposed no equivalent field before and now returns `runId`
  alongside the other frameworks.

  `ChatResumeState` and `GenerationResumeState` remain exported — they still
  describe the persisted resume snapshot (and `resumeInterruptsUnsafe` still takes
  a `ChatResumeState`). They are simply no longer part of a hook's return shape.

  New docs page: [Id map](https://tanstack.com/ai/latest/docs/persistence/id-map)
  covers what each id means on chat versus generation, how to choose a `threadId`,
  and when to read `runId`.

- [#970](https://github.com/TanStack/ai/pull/970) [`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a) - Make interrupt ownership explicit rather than assumed.

  An AG-UI `Interrupt` is a shared envelope — a workflow engine's durable
  approval or another agent framework's pause can arrive on the same stream. What
  makes a pause resumable through `chat()` is the binding this package attaches
  under `tanstack:interruptBinding`.
  - Interrupts that carry no binding this client understands now surface as
    `kind: 'unbound'` with `canResolve: false`, instead of being given a
    synthesized binding and rendered as resolvable generic interrupts. Resolving
    those produced an answer submitted against a run with nothing pending, which
    failed as `unknown-interrupt` only after the user had filled in the form.
    Unbound items never block submission of the interrupts that are yours.
  - The binding carries a wire version (`INTERRUPT_BINDING_VERSION`). Readers
    reject a version they don't recognise rather than duck-typing its fields. A
    binding written before the field existed is still read.
  - `INTERRUPT_BINDING_METADATA_KEY`, `withInterruptBinding()` and
    `readInterruptBinding()` are exported, so anything producing an interrupt this
    package must later resume attaches the binding through a supported API
    instead of copying the metadata key.
  - Interrupt classification is driven by the binding alone. `Interrupt.reason` is
    free-form AG-UI text another producer can also use, so it is now a display
    hint only and never decides ownership.
  - The interrupt protocol surface is enumerated instead of `export *`. The
    unimplemented durable-recovery contract (`InterruptRecoveryStateV1`,
    `InterruptRecoveryQuery`, the never-called `loadInterruptState` adapter hook,
    and the `persistence-required` / `atomic-commit-unsupported` /
    `recovery-unavailable` error codes) is removed rather than published.

- [#970](https://github.com/TanStack/ai/pull/970) [`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a) - Interrupts: the application owns wire-schema validation, and the hashing
  dependency is gone.

  The library no longer transforms a generic interrupt's wire JSON Schema into a
  validator or validates the resolved value against it, on either the client or
  the server. Whatever you pass to `resolveInterrupt` (client) or send in the
  `resume` batch (server) flows through as-is. Validate it yourself if you need to
  trust it, e.g. with `z.fromJSONSchema(interrupt.responseSchema).safeParse(value)`
  on the client and your own check on the server. Validation of a tool's
  code-authored Standard Schema (`approvalSchema` / `inputSchema`) is unchanged.

  This drops the `ajv` and `ajv-formats` dependencies. Interrupt binding hashes and
  resolution fingerprints now use a small bundled SHA-256 instead of
  `@noble/hashes`, so that dependency is gone too. The wire hash shape
  (`sha256:<hex>`) is unchanged.

- [#991](https://github.com/TanStack/ai/pull/991) [`cc88874`](https://github.com/TanStack/ai/commit/cc88874ecb0639daa1f8a8c32be5dcc9b2749371) - **Align `MemoryScope` to the shared `Scope` type (`threadId`).**

  `MemoryScope` is now an alias of `Scope` from `@tanstack/ai` so memory and
  persistence share one isolation vocabulary. The conversation key is
  `threadId` (required); optional dims are `userId`, `tenantId`, and reserved
  `namespace`. There is no public `sessionId` on memory scope — hard cut while
  `@tanstack/ai-memory` is still `0.x` / unreleased.
  - `@tanstack/ai-memory` — `export type MemoryScope = Scope`. Built-in adapters
    (`inMemory`, `redis`) and middleware use `threadId`; `sameScope` also matches
    `tenantId` when present on the query. Redis index keys are now
    `{prefix}:index:{tenantId|_}:{userId|_}:{threadId}` (escaped). Hindsight banks
    use `{user}__{threadId}`. Anyone who wrote Redis rows under the pre-rename
    layout needs to reindex or wipe — keys are not dual-read.
  - `@tanstack/ai-event-client` — `MemoryScopeLite` is
    `{ threadId?, userId?, tenantId? }` (devtools telemetry; not an isolation
    authority).
  - `@tanstack/ai-client` / `@tanstack/ai-devtools-core` — memory event payloads
    and the Memory panel registry follow the same `threadId` field names.

- [#955](https://github.com/TanStack/ai/pull/955) [`7c7aa09`](https://github.com/TanStack/ai/commit/7c7aa09a7402b45e6285ebc78a606131aec3e288) - Resumable streams: reconnect to an in-flight SSE **or NDJSON** response without
  re-running the provider.

  `toServerSentEventsResponse` and `toHttpResponse` both accept a
  `durability: { adapter, batch }` option. The adapter (`StreamDurability`)
  records every chunk to an ordered log before delivery and tags each event with
  an opaque, adapter-owned offset — an SSE `id:` line, or the `id` of an NDJSON
  `{ id, chunk }` envelope (NDJSON has no native event-id). A reconnect
  (`Last-Event-ID`) or an explicit `?offset` read replays strictly after that
  offset from the log — the lazy provider stream is never iterated on resume.
  Producers terminalize the log on cancellation and failure (`RUN_ERROR` append
  - `close()`) and on completion when the source stream emits its own terminal
    event (`chat()` always does), so readers are never parked on a dead run.

  Two adapters ship: `memoryStream(request)` in `@tanstack/ai` (process-local,
  for development and tests) and the new `@tanstack/ai-durable-stream` package,
  a Durable Streams protocol adapter for production backends.

  For the `GET` handler that a reload or a second tab reconnects to,
  `resumeServerSentEventsResponse({ adapter })` and `resumeHttpResponse({ adapter })`
  replay a run straight from the durability log. They need no producer stream and
  return a 400 when the request carries no resume offset.

  On the client, all four HTTP adapters are now resumable — `fetchServerSentEvents`,
  `fetchHttpStream`, `xhrServerSentEvents`, and `xhrHttpStream`. Each tracks the
  per-event offset, auto-reconnects with `Last-Event-ID`, de-duplicates the
  replayed prefix, and exposes `joinRun(runId)` to attach to an in-flight or
  finished run from the start (read-only GET with `offset=-1`). Untagged streams
  behave exactly as before. A durable run that ends with no terminal event and no
  forward progress now throws `DurableStreamIncompleteError` instead of hanging.

  Reconnection and durability are bounded so failures surface rather than hang or
  loop:
  - `memoryStream` evicts completed logs after a grace window (unbounded growth
    is gone); resuming an expired/unknown run throws, and a from-start join to a
    run that never produces fails after `MemoryStreamOptions.firstChunkDeadlineMs`.
  - all four HTTP adapters accept `reconnect: { maxAttempts, delayMs }` — a
    throttle plus a ceiling on CONSECUTIVE no-progress reconnects (default 5;
    forward progress resets it) that fails with the new `StreamReconnectLimitError`
    instead of reconnecting endlessly, without penalizing a healthy long-lived run.
  - `durableStream` accepts `reconnect: { maxReadFailures, delayMs }` to bound its
    read-retry loop, and `server` is now optional when `fetch` is provided (e.g. a
    Cloudflare service binding).
  - `toServerSentEventsResponse` accepts `debug` to record durability terminal /
    close failures server-side, where a replaying joiner cannot observe them.

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

- [#984](https://github.com/TanStack/ai/pull/984) [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a) - The chat hooks no longer take an `id` option — a hook's identity is its `threadId`.

  `useChat` / `createChat` previously accepted a separate `id` that keyed client
  persistence and named the devtools instance, defaulting to a framework
  `useId()` when omitted. That meant persistence keyed on an ephemeral render-tree
  id even when you passed a stable `threadId`, so a reload found nothing under the
  thread's key.

  Now the `threadId` is the single identity:
  - The hooks drop the `id` option. Pass `threadId` to persist a conversation and
    restore it on reload; omit it for an ephemeral chat.
  - Persistence keys on `threadId` (unchanged in `ChatClient`, which already
    resolved `id ?? threadId` — the hooks simply stop overriding it).
  - `ChatClient.uniqueId` (the devtools instance id) now falls back to `threadId`
    instead of a generated id, so a thread shows up in devtools under its own id.
  - Changing `threadId` on a mounted `useChat` (react/preact/solid) now recreates
    the client so the new thread takes effect; previously the change was ignored.

  `ChatClient` still accepts `id` directly as a lower-level escape hatch for
  keying storage separately from the wire thread; only the framework hooks drop it.

  Migration: replace `useChat({ id })` with `useChat({ threadId })`.

### Patch Changes

- [#984](https://github.com/TanStack/ai/pull/984) [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a) - Make a reload rejoin fast, robust, and repeatable.
  - **`memoryStream` first-chunk deadline now defaults to 100ms** (was 30s). The
    common from-start join is a reload rejoining a run whose producer ran in a
    prior request: an in-flight run's log already holds chunks (it streams
    immediately, the deadline never applies), and an empty log means the run is
    gone — so failing fast lets the client re-enable input near-instantly instead
    of holding a dead connection open. Raise `firstChunkDeadlineMs` for a backend
    whose producer can legitimately start well after a joiner attaches.
  - **`ChatClient` reload rejoin hardened:** it bounds the wait for the first
    chunk and clears a dead resume pointer (so a stale pointer can't pin the UI in
    a loading state and can't be retried on the next load); it drops the hydrated
    in-flight partial only when real content arrives (never on `RUN_STARTED`
    alone), so a rejoin that connects but delivers nothing can't leave an empty
    assistant bubble; and it no longer lets a replayed `RUN_STARTED` (which
    carries the provider run id) overwrite the persisted resume pointer with an id
    the durability log isn't keyed by — so a SECOND consecutive reload still
    re-attaches and continues.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - Fix generation mount hydration to run in the commit phase, and restore TTS
  results.
  - The `GenerationClient` / `VideoGenerationClient` used to kick off mount
    hydration from their constructor. Framework hooks build the client inside
    `useMemo`, so that ran in React's render phase, and several clients mounting
    together re-fired the hydrate GET on every discarded/speculative render,
    flooding the connection pool (`ERR_INSUFFICIENT_RESOURCES`). Hydration now runs once from `mountDevtools`
    (the hooks' commit-phase mount effect), guarded by `serverHydrationStarted`.
    `initialResumeSnapshot` still seeds SSR/first paint. Note for direct
    (non-framework) `GenerationClient`/`VideoGenerationClient` users: mount
    hydration and the "missing `hydrateGeneration` handler" warning now fire from
    `mountDevtools()` rather than the constructor, so call `mountDevtools()` (as
    every framework hook does on mount) to trigger a server/storage restore;
    `generate()` still triggers it too.
  - New `reconstructSpeechResult` mapper, wired into the speech hook of **every**
    framework package — `useGenerateSpeech` (React, Solid, Vue),
    `createGenerateSpeech` (Svelte) and `injectGenerateSpeech` (Angular). A
    restored `TTSResult` carries no base64 bytes (they live in the blob store), so
    it surfaces the durable serve URL through `result.artifacts`; the speech clip
    now repaints after a reload instead of showing status only. Previously only
    React was wired, so a restored TTS run on the other four repainted
    `status`/`error` but left `result` null.

- [#1011](https://github.com/TanStack/ai/pull/1011) [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5) - A generation mount-time rejoin that can't finish now settles to `error` instead
  of hanging on `generating`.
  - `recordResumeSnapshotError` surfaces `error` on the observable `status` even
    when a streamed `RUN_ERROR` already flipped the resume snapshot to `error`
    (via `observeResumeSnapshot`). Previously its early-return skipped
    `setStatus`, so a rejoin whose delivery log had aged out (or whose route
    couldn't serve the join) left the hook stuck on `generating` forever. Guarded
    so the live `generate()` path doesn't double-emit `error`.
  - `GenerationClient` / `VideoGenerationClient` `dispose()` no longer calls
    `stop()`: a teardown (unmount / React StrictMode dispose) must not mark the
    run non-resumable and wipe the `running` snapshot the way a user-driven
    `stop()` intentionally does — that destroyed the resume state so a remount
    could never rejoin. It now aborts only the in-flight delivery, keeps
    the snapshot resumable, and re-arms mount hydration so a remount rejoins.

- Updated dependencies [[`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`347b61b`](https://github.com/TanStack/ai/commit/347b61bc788bb816bbd12287c1a426ca7def00f4), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a), [`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`478a4da`](https://github.com/TanStack/ai/commit/478a4da3756e0de09548f2902da3b45748c27b52), [`347b61b`](https://github.com/TanStack/ai/commit/347b61bc788bb816bbd12287c1a426ca7def00f4), [`cc88874`](https://github.com/TanStack/ai/commit/cc88874ecb0639daa1f8a8c32be5dcc9b2749371), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`7c7aa09`](https://github.com/TanStack/ai/commit/7c7aa09a7402b45e6285ebc78a606131aec3e288), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`4ce7600`](https://github.com/TanStack/ai/commit/4ce7600d5b543d4b7e3bd6d63cdf5ecf91cdeeaa), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5)]:
  - @tanstack/ai@0.43.0
  - @tanstack/ai-event-client@0.7.0
  - @tanstack/ai-utils@0.4.0

## 0.22.1

### Patch Changes

- Updated dependencies [[`3e1b510`](https://github.com/TanStack/ai/commit/3e1b510e4fdd2334af468c47b7c37b572805200e)]:
  - @tanstack/ai@0.42.0

## 0.22.0

### Minor Changes

- [#900](https://github.com/TanStack/ai/pull/900) [`35946e3`](https://github.com/TanStack/ai/commit/35946e3c39fb123c133ebe662f8e2cf0139f2b8c) - Messages sent while a stream is already in flight are now queued by default and automatically sent once the in-flight stream settles, instead of being silently dropped. **This is a behavior change.** Restore the previous drop-while-busy behavior with `queue: 'drop'`.

  The behavior is configurable via a new `queue` option, which accepts `whenBusy: 'queue' | 'drop' | 'interrupt'`, `drain: 'fifo' | 'batch'`, `maxSize`, and `onOverflow`, or a custom strategy function for full control.

  Queued messages are exposed on the hook as `queue` and can be cancelled before they send via `cancelQueued(id)`. `sendMessage` also accepts a per-call `{ whenBusy }` override.

## 0.21.0

### Minor Changes

- [#405](https://github.com/TanStack/ai/pull/405) [`2665085`](https://github.com/TanStack/ai/commit/2665085970ab4d792778bb2b635ef27fbdcb6be1) - Added Gemini Realtime Adapter

- [#918](https://github.com/TanStack/ai/pull/918) [`f830d9e`](https://github.com/TanStack/ai/commit/f830d9e7a41e3554c424c3e41ba847dfd1577589) - Gate the tool-call part's `approval` field on the tool's `needsApproval` flag.
  Previously `approval?` was declared on every typed tool-call part regardless of
  whether the tool could ever request approval. Now the flag is captured as a
  literal type (`toolDefinition({ needsApproval: true })` → `true`) and threaded
  through `ClientTool` / `ToolDefinitionInstance` / `ToolDefinition`, and
  `ToolCallPartForTool` only includes `approval` for tools defined with
  `needsApproval: true`:

  ```ts
  const { messages } = useChat({ tools: [getGuitars, addToCart] }) // addToCart: needsApproval: true
  for (const part of message.parts) {
    if (part.type !== 'tool-call') continue
    if (part.name === 'addToCart') part.approval?.id // ✅ typed
    if (part.name === 'getGuitars') part.approval // ✅ compile error — no such field
  }
  ```

  ## ⚠️ Breaking change (types only)

  **This is the primary migration surface for this release.** When you pass a typed
  `tools` array to `useChat` / `createChat` / `injectChat`, reading `part.approval`
  on a mixed tool-call union **without first narrowing by `part.name`** no longer
  compiles. Code that previously did `part.approval?.id` in a generic handler over
  all tool-call parts must be updated:

  ```ts
  // ❌ No longer compiles on a typed mixed union
  part.approval?.id

  // ✅ Narrow to an approval-required tool first
  if (part.name === 'deleteAccount') part.approval?.id

  // ✅ Or guard with `in`
  if ('approval' in part) part.approval?.id

  // ✅ Or type the handler against the base (untyped) ToolCallPart
  function handleApproval(part: ToolCallPart) {
    return part.approval?.id
  }
  ```

  Untyped `useChat()` (no inferred `tools` generic) and the base `ToolCallPart`
  type are unaffected: `approval` stays available on every tool-call part there.
  **Runtime behavior is unchanged** — only TypeScript narrowing is stricter.

  Adds a `TNeedsApproval extends boolean` type parameter (defaulting to `false`)
  to the client tool types; existing explicit type arguments keep working via the
  default. Literal capture requires `toolDefinition({ needsApproval: true })` at
  the call site — a dynamic `needsApproval: boolean` variable will not gate the
  type.

### Patch Changes

- Updated dependencies [[`5fcaf90`](https://github.com/TanStack/ai/commit/5fcaf90dc82bc20b8c7a75faa3c129da04858af5), [`2665085`](https://github.com/TanStack/ai/commit/2665085970ab4d792778bb2b635ef27fbdcb6be1), [`e0bbbdd`](https://github.com/TanStack/ai/commit/e0bbbdd9608892293e09135aab4a3c77c8d65669), [`f830d9e`](https://github.com/TanStack/ai/commit/f830d9e7a41e3554c424c3e41ba847dfd1577589), [`f830d9e`](https://github.com/TanStack/ai/commit/f830d9e7a41e3554c424c3e41ba847dfd1577589), [`de5fbb5`](https://github.com/TanStack/ai/commit/de5fbb52a916826cdc0ef31d18df402cd611b9d4)]:
  - @tanstack/ai@0.41.0

## 0.20.0

### Minor Changes

- [#651](https://github.com/TanStack/ai/pull/651) [`5deda27`](https://github.com/TanStack/ai/commit/5deda27085c8785894a28feb5bb3655dbd8f7e0a) - Add OpenAI transcription diarization support with `diarized_json` output, speaker-labeled segments, diarization model validation, chunking strategy options, and docs.

### Patch Changes

- Updated dependencies [[`5deda27`](https://github.com/TanStack/ai/commit/5deda27085c8785894a28feb5bb3655dbd8f7e0a)]:
  - @tanstack/ai@0.40.0

## 0.19.2

### Patch Changes

- Updated dependencies [[`afba322`](https://github.com/TanStack/ai/commit/afba32236022589afce4d5a165fd4a8a884ae57d), [`e7ad181`](https://github.com/TanStack/ai/commit/e7ad181cad20c5d6560f480835c99ff1142b40af)]:
  - @tanstack/ai@0.39.1

## 0.19.1

### Patch Changes

- Updated dependencies [[`b628a4d`](https://github.com/TanStack/ai/commit/b628a4da5fd21184922c6944059768d1ed6071d4), [`b628a4d`](https://github.com/TanStack/ai/commit/b628a4da5fd21184922c6944059768d1ed6071d4)]:
  - @tanstack/ai@0.39.0

## 0.19.0

### Minor Changes

- [#810](https://github.com/TanStack/ai/pull/810) [`33acdd4`](https://github.com/TanStack/ai/commit/33acdd4df4aef13d594700d9b52087252091bd40) - Add `AudioRecorder` (`@tanstack/ai-client`) and framework hooks for recording an
  audio message in the browser: `useAudioRecorder` (React/Solid/Vue),
  `createAudioRecorder` (Svelte), and `injectAudioRecorder` (Angular). The
  recording exposes a ready-to-use audio content part (`.part`) for `sendMessage`
  and base64 (`.base64`) for the generation hooks. Native recorder output
  (webm/mp4), no transcoding, no new dependency.

  Each hook also returns a reactive `recording` field — the latest resolved
  recording (`AudioRecording | null`), available without awaiting `stop()`. Pass
  `onComplete: (recording) => T | Promise<T>` to transform the output: `stop()`
  then resolves to `T` and `recording` becomes `T | null`. Omitting `onComplete`
  keeps the raw `AudioRecording`.

- [#843](https://github.com/TanStack/ai/pull/843) [`c1a8732`](https://github.com/TanStack/ai/commit/c1a87327b4a3463d37158f32ca90184b5fd092bb) - feat: MCP Apps support — render interactive `ui://` widgets served by MCP servers

  Adds support for the ratified [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview) standard, letting MCP server tools return interactive UI widgets that render in the chat.
  - **`@tanstack/ai`** — MCP tool results that link a `ui://` resource (via `_meta.ui.resourceUri`) now surface as a new `UIResourcePart` on the assistant `UIMessage` (carried as an AG-UI `CUSTOM` event). The widget never enters model input. The `ui://` resource is read eagerly during the run, fail-soft.
  - **`@tanstack/ai-mcp`** — tool discovery now captures `serverId` + the UI resource link; `MCPClient` gains a public `callTool` and `getInfo()` (returns the client's transport descriptor); `MCPClients` gains `getServers()` (returns all pool entries' descriptors). New `@tanstack/ai-mcp/apps` subpath exports `createMcpAppCallHandler` — a server-side tool-call proxy for interactive widgets that takes the MCP client(s)/pool you already created (`clients: MCPClient | MCPClients | Array<MCPClient | MCPClients>`), reads each client's transport descriptor via `MCPClient.getInfo()` / `MCPClients.getServers()` (pure config, no live socket required), and **reconnects per call** (stateless, serverless-safe by default, same-server allowlist). Also exports an in-memory `McpSessionStore` seam for stateful transports.
  - **`@tanstack/ai-client`** — `createMcpAppBridge`, a framework-agnostic bridge routing widget tool-calls to the call handler, follow-up prompts into the chat, and blocking links unless a handler is supplied.
  - **`@tanstack/ai-react` / `@tanstack/ai-preact`** — a `MCPAppResource` component (new `./mcp-apps` subpath) that renders a `UIResourcePart` via `@mcp-ui/client`'s `AppRenderer` (optional peer dependency), wired to the bridge. Plus a `useMcpAppBridge` hook (main entry) that returns a stable `createMcpAppBridge` for a given `threadId`/`callEndpoint` while always calling the latest `sendMessage`/`onLink`.

  Persistence is intentionally out of scope (in-memory seams only); Solid/Vue/Svelte/Angular renderers are deferred (the renderer SDK is currently React-only).

### Patch Changes

- Updated dependencies [[`c1a8732`](https://github.com/TanStack/ai/commit/c1a87327b4a3463d37158f32ca90184b5fd092bb)]:
  - @tanstack/ai@0.38.0

## 0.18.6

### Patch Changes

- [#844](https://github.com/TanStack/ai/pull/844) [`a6cceba`](https://github.com/TanStack/ai/commit/a6cceba4812e7e986183ee856112fcf5f8fa12ff) - Republish all packages with their compiled `dist/` output.

  Releases `0.33.0`–`0.36.0` were published without a `dist/` directory: the
  release workflow relied on an Nx-cached `build` whose outputs were not
  materialized to disk before `changeset publish` packed the tarballs, and
  `files: ["dist"]` silently includes nothing when `dist/` is absent. The
  published packages therefore contained only `src/`, so every export
  (`./dist/esm/*.js`) resolved to a missing file and the packages were
  uninstallable.

  The publish step now runs a fresh, cache-bypassing build of all packages
  immediately before publishing, guaranteeing compiled artifacts are present in
  every tarball.

- Updated dependencies [[`a6cceba`](https://github.com/TanStack/ai/commit/a6cceba4812e7e986183ee856112fcf5f8fa12ff)]:
  - @tanstack/ai@0.37.0
  - @tanstack/ai-event-client@0.6.8

## 0.18.5

### Patch Changes

- Updated dependencies [[`fbd3762`](https://github.com/TanStack/ai/commit/fbd37623b287e370aa5678e161dec19cf13ae33b), [`e3ee4ae`](https://github.com/TanStack/ai/commit/e3ee4ae385d124619586f7c6de96b5c7de5954c5)]:
  - @tanstack/ai@0.36.0
  - @tanstack/ai-event-client@0.6.7

## 0.18.4

### Patch Changes

- [#830](https://github.com/TanStack/ai/pull/830) [`c04abd3`](https://github.com/TanStack/ai/commit/c04abd35284d464d830bb9f15129c7a7c2533d3f) - Move the `RealtimeAdapter` / `RealtimeConnection` contract into `@tanstack/ai` and stop provider adapters from depending on `@tanstack/ai-client`.

  Provider packages (`@tanstack/ai-openai`, `@tanstack/ai-elevenlabs`, `@tanstack/ai-grok`) are usable server-side (text, embeddings, images, transcription, token minting, etc.) and must not pull in the client-only `@tanstack/ai-client`. The only thing their realtime adapters needed from it were the `RealtimeAdapter` / `RealtimeConnection` type shapes.

  Those two interfaces now live in `@tanstack/ai` — the shared layer that both provider packages and `@tanstack/ai-client` already depend on, and where every other realtime type (`RealtimeToken`, `RealtimeEvent`, `RealtimeSessionConfig`, …) already lives. They're exported from `@tanstack/ai` and `@tanstack/ai/client`. `@tanstack/ai-client` re-exports them unchanged, so `import { RealtimeAdapter } from '@tanstack/ai-client'` keeps working.

  As a result `@tanstack/ai-client` is no longer a dependency (peer or otherwise) of any provider package, and the previously-duplicated local contract + drift test in `@tanstack/ai-grok` are removed in favor of the single shared definition. Consumers only need `@tanstack/ai-client` at the point where they actually construct a `RealtimeClient`.

- Updated dependencies [[`c04abd3`](https://github.com/TanStack/ai/commit/c04abd35284d464d830bb9f15129c7a7c2533d3f)]:
  - @tanstack/ai@0.35.0

## 0.18.3

### Patch Changes

- [#749](https://github.com/TanStack/ai/pull/749) [`540cbf1`](https://github.com/TanStack/ai/commit/540cbf18a2f7d6c07b44f7f4da0ac3873c0d2581) - Fix `useChat` status getting stuck after a client tool call when the continuation run closes with a bare `RUN_FINISHED { finishReason: 'stop' }` and no assistant message. The client only sets status `ready` via the processor's `onStreamEnd`, and `StreamProcessor.finalizeStream()` emits that callback only when it has a `lastAssistantMessage`; a message-less terminal run never fired it, so status stayed at `submitted`. The client now normalizes status to `ready` on the terminal, non-continuing path. Fixes [#421](https://github.com/TanStack/ai/issues/421).

- Updated dependencies [[`2e59b77`](https://github.com/TanStack/ai/commit/2e59b7730ef88a0107e8d7ad916906b070f6a6c0), [`4188693`](https://github.com/TanStack/ai/commit/4188693d09297ce400eb1ba5fab30cfea2fdb8a6)]:
  - @tanstack/ai-event-client@0.6.6
  - @tanstack/ai@0.34.1

## 0.18.2

### Patch Changes

- Updated dependencies [[`31de22b`](https://github.com/TanStack/ai/commit/31de22b1ae780c53e3abbf9cf17e1db7b62de84a)]:
  - @tanstack/ai@0.34.0
  - @tanstack/ai-event-client@0.6.5

## 0.18.1

### Patch Changes

- Updated dependencies [[`2cb0313`](https://github.com/TanStack/ai/commit/2cb0313c1f13e1db37c5550308e36bb0b9b73b98), [`18e5f4d`](https://github.com/TanStack/ai/commit/18e5f4d9746a26c3194929ea4b49673728e8eaa5), [`21720dd`](https://github.com/TanStack/ai/commit/21720dd73524d624594a6dfb7e4669c03cc08af0), [`243b8fa`](https://github.com/TanStack/ai/commit/243b8fad7e8a48b68a1a96962ee1443cbd6a0ced)]:
  - @tanstack/ai@0.33.0
  - @tanstack/ai-event-client@0.6.4

## 0.18.0

### Minor Changes

- [#624](https://github.com/TanStack/ai/pull/624) [`8fa6cc5`](https://github.com/TanStack/ai/commit/8fa6cc56c5f36e22885c98a511dcceb2bfc0da1f) - `generateImage()` and `generateVideo()` now accept a multimodal `prompt`: a plain string, or an ordered array of content parts (`TextPart` / `ImagePart` / `VideoPart` / `AudioPart`) for image-conditioned generation, image-to-image, multi-reference, image-to-video, and edit / inpaint flows. Part order is meaningful — "not like this _(image)_, more like this _(image)_" — and each media part may carry a `metadata.role` hint (`'reference' | 'mask' | 'control' | 'start_frame' | 'end_frame' | 'character'`) that adapters use to route to the provider-specific field, plus an informational `metadata.tag` label for your own bookkeeping. The accepted part types are narrowed per model at compile time via each adapter's input-modality map, so passing an image part to a text-only model is a type error (with a clear runtime throw as backstop).

  Prompt text is always sent **verbatim** — the SDK never injects or rewrites in-prompt referencing markers. To reference inputs from your prompt, write the provider's own convention (fal Kling / Seedance `@Image1`, OpenAI / FLUX.2 `"image 1"` prose, Gemini content descriptions); see the image-generation docs for the per-provider table.

  Provider behavior in this release:
  - **OpenAI image** — Prompts with image parts route `gpt-image-2` / `gpt-image-1` / `gpt-image-1-mini` to `images.edit()` (up to 16 source images plus optional mask); `dall-e-2` routes to `images.edit()` with one source image; `dall-e-3` rejects image parts at compile time and at runtime.
  - **OpenAI video** — Sora-2 / Sora-2-Pro accept a single image part as `input_reference`; passing more than one throws.
  - **Gemini image** — Native models (`gemini-*-flash-image`, "nano-banana") map prompt parts 1:1 onto multimodal `contents`, preserving interleaved order. Imagen is text-only (compile-time + runtime rejection).
  - **fal.ai** — Field names resolve per endpoint from a map generated from the fal SDK's endpoint types (362 endpoints with nonstandard fields, e.g. nano-banana edit → `image_urls`, Kling i2v start frame → `image_url`, Veo first-last-frame → `first_frame_url` / `last_frame_url`). Defaults for endpoints not in the map: single → `image_url`, multiple → `image_urls`; `role: 'mask'` → `mask_url`; `role: 'control'` → `control_image_url`; `role: 'reference'` / `'character'` → `reference_image_urls`; video `role: 'start_frame'` / `'end_frame'` → `start_image_url` / `end_image_url`. Per-model prompt modalities are derived at the type level from the SDK's endpoint input types. Regenerate the map after a fal SDK bump with `pnpm generate:fal-image-fields` (a unit test fails when it goes stale). In `FalImageProviderOptions` / `FalVideoProviderOptions`, media-conditioning fields the mappers can populate (`image_url`, `start_image_url`, `video_url`, `audio_url`, …) are demoted from required to optional — supply them as prompt parts, or keep passing them explicitly via `modelOptions`.
  - **Grok** — New `grok-imagine-image` / `grok-imagine-image-quality` models. Prompts with image parts route to xAI's JSON `/v1/images/edits` endpoint (up to 3 source images, addressed by xAI in request order; the prompt is sent verbatim). `role: 'mask'` / `'control'` throw. Their `size` uses an `aspectRatio_resolution` template (`'16:9_2k'`, suffix optional) mirroring Gemini's native image models. `grok-2-image-1212` remains text-to-image only.
  - **OpenRouter** — Prompt parts map 1:1 onto multimodal `text` / `image_url` chat content parts, preserving interleaved order, and are forwarded to the underlying image model. URL sources pass through verbatim (no fetching or re-encoding in your process); `data` sources become data URIs.
  - **Anthropic** — Unchanged (no image generation API).

  A new `resolveMediaPrompt()` utility (exported from `@tanstack/ai`) is the single downrev point from the canonical interleaved prompt shape to flattened text + per-modality part buckets, for adapter authors.

  On the client side, `ImageGenerateInput.prompt` and `VideoGenerateInput.prompt` (`@tanstack/ai-client`, and the `useGenerateImage` / `useGenerateVideo` hooks built on them) are widened from `string` to the same `MediaPrompt` shape, so prompt parts can be sent from the browser through your server route to `generateImage()` / `generateVideo()`.

  Closes [#618](https://github.com/TanStack/ai/issues/618).

### Patch Changes

- Updated dependencies [[`8fa6cc5`](https://github.com/TanStack/ai/commit/8fa6cc56c5f36e22885c98a511dcceb2bfc0da1f), [`8fa6cc5`](https://github.com/TanStack/ai/commit/8fa6cc56c5f36e22885c98a511dcceb2bfc0da1f)]:
  - @tanstack/ai@0.32.0
  - @tanstack/ai-event-client@0.6.3

## 0.17.3

### Patch Changes

- Updated dependencies [[`07aaf8b`](https://github.com/TanStack/ai/commit/07aaf8b9e5a8e699be25f936cc9cd651a46c16c5)]:
  - @tanstack/ai@0.31.0
  - @tanstack/ai-event-client@0.6.2

## 0.17.2

### Patch Changes

- [#752](https://github.com/TanStack/ai/pull/752) [`4d5141c`](https://github.com/TanStack/ai/commit/4d5141c128c0e9bd33cdbf36a5402811cefc3f8b) - Fix `ChatClient` throwing `TypeError: this.devtoolsBridge.mountWithTools is not a function` on the first `sendMessage()` (and on `updateOptions({ tools })`) when no devtools bridge factory is supplied. The default `NoOpChatDevtoolsBridge` was missing the `mountWithTools`, `notifyToolsChanged`, and `recordStreamId` methods of the real bridge; the throw happened before the user message was appended, so the first message was silently lost. The compile-time parity check between the real and no-op bridges now fails the build when the surfaces drift.

## 0.17.1

### Patch Changes

- [#769](https://github.com/TanStack/ai/pull/769) [`1d1bb52`](https://github.com/TanStack/ai/commit/1d1bb5219a38d9718cc926148e93fc27d5d2305b) - Add repository metadata (`homepage`, `bugs`, `funding`), fix `repository.directory` to point at each package, and include an MIT `LICENSE` file in every published package.

- Updated dependencies [[`7103348`](https://github.com/TanStack/ai/commit/71033488212bff05dcccc857e721ab9262ebc2a6), [`1d1bb52`](https://github.com/TanStack/ai/commit/1d1bb5219a38d9718cc926148e93fc27d5d2305b)]:
  - @tanstack/ai@0.30.0
  - @tanstack/ai-event-client@0.6.1

## 0.17.0

### Minor Changes

- [#727](https://github.com/TanStack/ai/pull/727) [`7d44569`](https://github.com/TanStack/ai/commit/7d445693ea079d7a85498a4465179ddd5f548cb0) - Add an `'error'` terminal to `ToolCallState`. When a tool execution produces an output error, the StreamProcessor now transitions the `tool-call` part to `state: 'error'` instead of parking it at `'input-complete'`.

  Previously an errored tool call left the tool-call part at `'input-complete'` forever, so UIs that render lifecycle from the part's `state` could not distinguish "still executing" from "failed" without reverse-engineering the error-shaped `output` or the sibling `tool-result` part. The new terminal makes the tool-call state machine self-describing and symmetric with `ToolResultState` (which already has `'error'`):

  ```ts
  if (part.type === 'tool-call' && part.state === 'error') {
    // render failure — no more inferring from output shape
  }
  ```

  The completion safety net (`RUN_FINISHED` / stream finalization) no longer downgrades a failed tool call back to `'input-complete'`, including when an `output-error` result arrives before `TOOL_CALL_END`.

### Patch Changes

- Updated dependencies [[`ff267a5`](https://github.com/TanStack/ai/commit/ff267a5536327b006979f9f28ce2df7cc27f6e23), [`570c08a`](https://github.com/TanStack/ai/commit/570c08a8d1a35746c3d31a63188249cba2d2475a), [`ff267a5`](https://github.com/TanStack/ai/commit/ff267a5536327b006979f9f28ce2df7cc27f6e23), [`22c9b42`](https://github.com/TanStack/ai/commit/22c9b42baec74914b720e440f29bd02be04eb164), [`215b6b4`](https://github.com/TanStack/ai/commit/215b6b401aa95d1d38da342aa09603cb1d616929), [`7d44569`](https://github.com/TanStack/ai/commit/7d445693ea079d7a85498a4465179ddd5f548cb0)]:
  - @tanstack/ai@0.29.0
  - @tanstack/ai-event-client@0.6.0

## 0.16.3

### Patch Changes

- Updated dependencies [[`496e814`](https://github.com/TanStack/ai/commit/496e8143435746965b10e0bbd12f26ebf04ae2a6), [`c0af426`](https://github.com/TanStack/ai/commit/c0af4262d269be67c69d6f878d9618f25fdeee19), [`00e0c93`](https://github.com/TanStack/ai/commit/00e0c932e6cb5e31f75f4b5e94486d7eb02b9ce1), [`496e814`](https://github.com/TanStack/ai/commit/496e8143435746965b10e0bbd12f26ebf04ae2a6)]:
  - @tanstack/ai@0.28.0
  - @tanstack/ai-event-client@0.5.4

## 0.16.2

### Patch Changes

- Updated dependencies [[`6df32b5`](https://github.com/TanStack/ai/commit/6df32b53026673d159e6df0892ce89effcb5c7b8)]:
  - @tanstack/ai@0.27.0
  - @tanstack/ai-event-client@0.5.3

## 0.16.1

### Patch Changes

- Updated dependencies [[`7adff0f`](https://github.com/TanStack/ai/commit/7adff0f192e50c081b569ffb80bf65df2a404a1f)]:
  - @tanstack/ai-event-client@0.5.2
  - @tanstack/ai@0.26.1

## 0.16.0

### Minor Changes

- [#661](https://github.com/TanStack/ai/pull/661) [`755e995`](https://github.com/TanStack/ai/commit/755e9953a31e879c4b88df0e7672ce1224886c97) - Add persistence support for chat messages.

## 0.15.2

### Patch Changes

- Updated dependencies [[`5d6cd28`](https://github.com/TanStack/ai/commit/5d6cd2834ba7ac1d7c7c1bd24ede202bf3e78010)]:
  - @tanstack/ai@0.26.0
  - @tanstack/ai-event-client@0.5.1

## 0.15.1

### Patch Changes

- Updated dependencies [[`c251038`](https://github.com/TanStack/ai/commit/c251038c6d8aa84e498f89e314ce5bb233bc689f)]:
  - @tanstack/ai@0.25.0
  - @tanstack/ai-event-client@0.5.0

## 0.15.0

### Minor Changes

- [#666](https://github.com/TanStack/ai/pull/666) [`c1ae8b9`](https://github.com/TanStack/ai/commit/c1ae8b94c83d70508975568eb4fc9b45f1af540b) - feat: support multimodal (image) tool results

  Tools may now return an `Array<ContentPart>` (e.g. a text part plus an image part) and have it transmitted to the model as structured multimodal tool output instead of a `JSON.stringify`'d blob. This unblocks use cases like returning a screenshot from a tool so the model can see it (issue [#363](https://github.com/TanStack/ai/issues/363)).
  - Detection is structural and opt-in by shape: a tool that returns a non-empty array whose every element is a valid `ContentPart` is passed through unchanged; strings and all other return values are serialized exactly as before, so there are no breaking changes.
  - The OpenAI Responses, Anthropic, and Google Gemini adapters convert the content parts into their native multimodal tool-output formats (`function_call_output.output`, `tool_result` content blocks, and `functionResponse.parts` respectively). Providers on the Chat Completions path (Groq, Ollama, Grok, OpenRouter chat) fall back to stringifying, which their APIs require.
  - AG-UI stream events (`TOOL_CALL_RESULT.content`, `TOOL_CALL_END.result`) remain string-only per the spec; the multimodal array travels on the tool message itself.

- [#628](https://github.com/TanStack/ai/pull/628) [`8036b50`](https://github.com/TanStack/ai/commit/8036b5054330a180023c6e3225b8d2735a43a919) - Add typed runtime context for tools and middleware.

  Tools and middleware can now declare the runtime context shape they require, and
  `chat()`, `ChatClient`, and the framework `useChat` / `createChat` hooks infer
  the merged requirement and type-check the `context` option you pass against it.

  ```typescript
  type AppContext = { userId: string; db: Db }

  const listNotes = toolDefinition({
    name: 'list_notes' /* ... */,
  }).server<AppContext>((_input, ctx) =>
    ctx.context.db.notes.findMany({ userId: ctx.context.userId }),
  )

  chat({
    adapter,
    messages,
    tools: [listNotes],
    context: { userId, db }, // required and type-checked because listNotes declares AppContext
  })
  ```

  Runtime context is request-local application state for tool and middleware
  implementations (authenticated users, database clients, tenancy, feature flags,
  loggers, browser services). It is never sent to the model and is distinct from
  the AG-UI `RunAgentInput.context` protocol field.

  Untyped tools and middleware continue to receive `unknown` context and do not
  force a `context` option. Client tools receive client-local context via
  `ChatClient` / `useChat`; use `forwardedProps` to hand serializable client data
  to the server and map it into server context explicitly. See the new Runtime
  Context guide for details.

  Behavior change: tool output validation now also runs when a tool returns
  `undefined` or `null`. Previously these values bypassed `outputSchema`
  validation entirely; now the schema decides whether they are valid, so a tool
  whose schema forbids `undefined`/`null` surfaces a validation error
  (`output-error`) instead of silently passing. Tools whose schema permits
  `null`/`undefined` (e.g. nullable or void outputs) are unaffected.

### Patch Changes

- Updated dependencies [[`c1ae8b9`](https://github.com/TanStack/ai/commit/c1ae8b94c83d70508975568eb4fc9b45f1af540b), [`a452ae8`](https://github.com/TanStack/ai/commit/a452ae8bcda8abfdc6309983976ed0fbf6df1915), [`8036b50`](https://github.com/TanStack/ai/commit/8036b5054330a180023c6e3225b8d2735a43a919)]:
  - @tanstack/ai@0.24.0
  - @tanstack/ai-event-client@0.4.3

## 0.14.1

### Patch Changes

- Updated dependencies [[`94bb9c0`](https://github.com/TanStack/ai/commit/94bb9c0f3a3e56a0c6c8b7c78f44ae41288aecc3)]:
  - @tanstack/ai@0.23.1
  - @tanstack/ai-event-client@0.4.2

## 0.14.0

### Minor Changes

- [#647](https://github.com/TanStack/ai/pull/647) [`d5645cf`](https://github.com/TanStack/ai/commit/d5645cfd4d1b9cfc877f7d4d714517e166a99ce3) - Add React Native support for chat clients and framework hooks, including
  client-safe streaming utilities and connection adapters that work in mobile
  environments.

  The `fetcher` option is now available on `ChatClient` and the framework chat
  hooks (`useChat` / `createChat`), mirroring the generation hooks. Pass either
  `connection` or `fetcher` -- the XOR is enforced at the type level via
  `ChatTransport`. Fetchers may return either a `Response` (parsed as SSE) or an
  `AsyncIterable<StreamChunk>` (yielded directly).

  The client-safe `@tanstack/ai/client` subpath is now public for framework
  packages and mobile bundles. `stream()`, `fetchServerSentEvents`,
  `fetchHttpStream`, `rpcStream`, `xhrServerSentEvents`, and `xhrHttpStream` are
  available from the client package and framework re-exports. React Native docs,
  an Expo chat example, and smoke tests are included for the supported mobile
  setup.

### Patch Changes

- Updated dependencies [[`980ff9b`](https://github.com/TanStack/ai/commit/980ff9ba925f5dbae62a9318cc1e787d0ae24314), [`d5645cf`](https://github.com/TanStack/ai/commit/d5645cfd4d1b9cfc877f7d4d714517e166a99ce3)]:
  - @tanstack/ai@0.23.0
  - @tanstack/ai-event-client@0.4.1

## 0.13.0

### Minor Changes

- [#632](https://github.com/TanStack/ai/pull/632) [`5634f18`](https://github.com/TanStack/ai/commit/5634f186a4946ca3e1942fbfcbf1291ec9bd9855) - Add hook-aware AI devtools registration, run tracking, state snapshots, and tool fixture replay.

### Patch Changes

- Updated dependencies [[`5634f18`](https://github.com/TanStack/ai/commit/5634f186a4946ca3e1942fbfcbf1291ec9bd9855)]:
  - @tanstack/ai-event-client@0.4.0
  - @tanstack/ai@0.22.1

## 0.12.0

### Minor Changes

- Add a `fetcher` option to `ChatClient` and the framework chat hooks ([#512](https://github.com/TanStack/ai/pull/512))
  (`useChat` / `createChat`), mirroring the `fetcher` option on the
  generation hooks. Pass either `connection` or `fetcher` — the XOR is
  enforced at the type level via `ChatTransport`.

  ```ts
  useChat({
    fetcher: ({ messages }, { signal }) =>
      chatFn({ data: { messages }, signal }),
  })
  ```

  The fetcher may return either a `Response` (parsed as SSE) or an
  `AsyncIterable<StreamChunk>` (yielded directly). `stream()`,
  `fetchServerSentEvents`, `fetchHttpStream`, and `rpcStream` are unchanged.

## 0.11.8

### Patch Changes

- Updated dependencies [[`02f7d04`](https://github.com/TanStack/ai/commit/02f7d0427a406bd2dda6f5a51d1ef1d2600d5ac9)]:
  - @tanstack/ai@0.22.0
  - @tanstack/ai-event-client@0.3.11

## 0.11.7

### Patch Changes

- Populate server-executed tool results on the matching `tool-call` part and mark successful tool calls as `complete`. ([#596](https://github.com/TanStack/ai/pull/596))

- Updated dependencies [[`e144a53`](https://github.com/TanStack/ai/commit/e144a53e4348bb0bc365dbe342c8538544242227)]:
  - @tanstack/ai@0.21.3
  - @tanstack/ai-event-client@0.3.10

## 0.11.6

### Patch Changes

- Refresh package README content and npm metadata for better discoverability. ([#626](https://github.com/TanStack/ai/pull/626))

- Updated dependencies [[`ebeb22e`](https://github.com/TanStack/ai/commit/ebeb22ec68f456b09e0181ac6f5d1ac25a0affd2)]:
  - @tanstack/ai@0.21.2
  - @tanstack/ai-event-client@0.3.9

## 0.11.5

### Patch Changes

- Updated dependencies [[`573f12e`](https://github.com/TanStack/ai/commit/573f12eb5a3b04a2625be92900099f48d6f76632)]:
  - @tanstack/ai@0.21.1
  - @tanstack/ai-event-client@0.3.8

## 0.11.4

### Patch Changes

- Expose the connection adapter primitives needed to build custom ([#597](https://github.com/TanStack/ai/pull/597))
  transports from every framework hook package. `@tanstack/ai-client`
  now re-exports `RunAgentInputContext` at its entry point, and
  `@tanstack/ai-react`, `@tanstack/ai-vue`, `@tanstack/ai-solid`,
  `@tanstack/ai-svelte`, and `@tanstack/ai-preact` now re-export
  `rpcStream`, `ConnectConnectionAdapter`, `SubscribeConnectionAdapter`,
  and `RunAgentInputContext` alongside the existing `stream`,
  `fetchServerSentEvents`, and `fetchHttpStream` re-exports.

  Previously, authors of WebSocket / persistent or RPC-backed adapters
  had to import these symbols from `@tanstack/ai-client` even though
  they were already pulling `useChat` from a framework package. No
  runtime change.

- Updated dependencies [[`ec1393d`](https://github.com/TanStack/ai/commit/ec1393db4383798e5f2574dfd87779c22c309529), [`188fe11`](https://github.com/TanStack/ai/commit/188fe11b9b9691e5a241cfc416803da5b8ce5376)]:
  - @tanstack/ai@0.21.0
  - @tanstack/ai-event-client@0.3.7

## 0.11.3

### Patch Changes

- Updated dependencies [[`2ad137b`](https://github.com/TanStack/ai/commit/2ad137bd22512248bd1684cccce35ba89597cf96)]:
  - @tanstack/ai@0.20.1
  - @tanstack/ai-event-client@0.3.6

## 0.11.2

### Patch Changes

- Updated dependencies [[`496db9c`](https://github.com/TanStack/ai/commit/496db9c42a7d3051a1295091eae29ae1c31ef997)]:
  - @tanstack/ai@0.20.0
  - @tanstack/ai-event-client@0.3.5

## 0.11.1

### Patch Changes

- Updated dependencies [[`617b5b5`](https://github.com/TanStack/ai/commit/617b5b512a6b3989c442efa41975dacc194d882a)]:
  - @tanstack/ai@0.19.1
  - @tanstack/ai-event-client@0.3.4

## 0.11.0

### Minor Changes

- feat: structured-output as a typed MessagePart on each assistant UIMessage ([#577](https://github.com/TanStack/ai/pull/577))

  `useChat({ outputSchema })` (React, Vue, Solid) and `createChat({ outputSchema })` (Svelte) previously kept a single hook-level `partial`/`final` slot, so multi-turn structured chats lost every prior turn's response as soon as a new one streamed in. Each assistant turn now carries its own typed `structured-output` MessagePart on the UIMessage it belongs to. History walks `messages` and finds the typed part on each turn; the hook-level `partial` and `final` are derived from the latest assistant message's part and continue to work as before. Applies to all four framework hook packages.

  The structured-output part type is generic over the schema's inferred data type:
  - `StructuredOutputPart<TData = unknown>` in `@tanstack/ai` carries `data: TData`, `partial: DeepPartial<TData>`, `raw: string`, plus `status: 'streaming' | 'complete' | 'error'` and an optional `errorMessage`.
  - `MessagePart<TTools, TData>` and `UIMessage<TTools, TData>` in `@tanstack/ai-client` thread the generic through the message types.
  - Each framework hook's return (`UseChatReturn<TTools, TSchema>` for React / Vue / Solid, `CreateChatReturn<TTools, TSchema>` for Svelte) substitutes `TData = InferSchemaType<TSchema>` when a schema is supplied, so `messages[i].parts.find(p => p.type === 'structured-output').data` is typed by the schema with no cast required.

  Default `TData = unknown` keeps every existing consumer that doesn't pass a schema source-compatible.

  Server-side `chat({ outputSchema, stream: true })` emits a new `structured-output.start` CUSTOM event before the JSON deltas so the client processor can route them into the StructuredOutputPart instead of building a TextPart. The wire converter serializes the part's raw JSON back as assistant content, so multi-turn structured chats stay coherent (the LLM sees its own prior structured responses on follow-up turns). For adapters without native JSON-schema streaming (Anthropic, Gemini, Ollama), the existing fallback path emits one terminal `structured-output.complete` event and the same per-turn typed part lands on the message — consumer code is identical.

  A new example route demonstrating the multi-turn pattern is at `/generations/structured-chat` in the `ts-react-chat` example.

  **Breaking-shape note (minor, not major):** When `outputSchema` is set, `TEXT_MESSAGE_CONTENT` deltas no longer create a `TextPart` on the assistant message — they accumulate into the `StructuredOutputPart`. Consumers that iterated `message.parts` and explicitly filtered out `TextPart`s to hide raw JSON (the workaround documented prior to this change) can remove that filter; doing nothing is also safe because no `TextPart` is produced in the first place.

### Patch Changes

- Updated dependencies [[`2e0e2eb`](https://github.com/TanStack/ai/commit/2e0e2eb72684aac82e570d57767656e218289b49)]:
  - @tanstack/ai@0.19.0
  - @tanstack/ai-event-client@0.3.3

## 0.10.0

### Minor Changes

- **Breaking:** AG-UI client-to-server compliance. ([#511](https://github.com/TanStack/ai/pull/511))

  `@tanstack/ai-client` now POSTs an AG-UI `RunAgentInput` request body and `@tanstack/ai` server endpoints must use the new `chatParamsFromRequestBody` + `mergeAgentTools` helpers. Upgrade both packages together.

  Highlights:
  - **Wire format**: `{threadId, runId, state, messages, tools, context, forwardedProps}` (per AG-UI 0.0.52 `RunAgentInputSchema`) instead of `{messages, data}`.
  - **New server helpers** exported from `@tanstack/ai`: `chatParamsFromRequestBody`, `mergeAgentTools`.
  - **`chat()` accepts `threadId`, `runId`, `parentRunId`** as optional fields for AG-UI run correlation.
  - **`ChatClient` accepts `threadId`** option; auto-generates and persists per session if omitted; fresh `runId` per send.
  - **Client tools auto-advertised** to the server via `RunAgentInput.tools`.
  - **Foreign AG-UI clients** can hit a TanStack server: `developer` collapses to `system`, `reasoning`/`activity` drop.

  See `docs/migration/ag-ui-compliance.md` for full migration steps.

### Patch Changes

- Updated dependencies [[`a9d1916`](https://github.com/TanStack/ai/commit/a9d19165a5028515cf1d091d611c8ac4b5b86099), [`e810153`](https://github.com/TanStack/ai/commit/e810153b34e593d3f3e1bbd8050164a6ad4423ed)]:
  - @tanstack/ai@0.18.0
  - @tanstack/ai-event-client@0.3.2

## 0.9.2

### Patch Changes

- Updated dependencies [[`98979f7`](https://github.com/TanStack/ai/commit/98979f7e72f4b5bfb816fb14b60a12871f8c4bec), [`02527c2`](https://github.com/TanStack/ai/commit/02527c28c3285829535cd486e529e659260b3c5d)]:
  - @tanstack/ai@0.17.0
  - @tanstack/ai-event-client@0.3.1

## 0.9.1

### Patch Changes

- Updated dependencies [[`87f305c`](https://github.com/TanStack/ai/commit/87f305c9961d608fd7bea93a5100698a98aed11d)]:
  - @tanstack/ai@0.16.0
  - @tanstack/ai-event-client@0.3.0

## 0.9.0

### Minor Changes

- **Fix thinking blocks getting merged across steps and lost on turn 2+ of Anthropic tool loops.** ([#391](https://github.com/TanStack/ai/pull/391))

  Each thinking step emitted by the adapter now produces its own `ThinkingPart` on the `UIMessage` instead of being merged into a single part, and thinking content + Anthropic signatures are preserved in server-side message history so multi-turn tool flows with extended thinking work correctly.

  This includes a public callback signature change: `StreamProcessorEvents.onThinkingUpdate` now receives `(messageId, stepId, content)` instead of `(messageId, content)`. `ChatClient` has been updated to handle the new `stepId` argument internally, but consumers implementing `StreamProcessorEvents` directly need to add the new parameter.

  `@tanstack/ai`:
  - `ThinkingPart` gains optional `stepId` and `signature` fields.
  - `ModelMessage` gains an optional `thinking?: Array<{ content; signature? }>` field so prior thinking can be replayed in subsequent turns.
  - `StepFinishedEvent` gains an optional `signature` field for provider-supplied thinking signatures.
  - `StreamProcessor` tracks thinking per-step via `stepId` and keeps step ordering. `getState().thinking` / `getResult().thinking` concatenate step contents in order.
  - The `onThinkingUpdate` callback on `StreamProcessorEvents` now receives `(messageId, stepId, content)` — consumers implementing it directly must add the `stepId` parameter.
  - `TextEngine` accumulates thinking + signatures per iteration and includes them in assistant messages with tool calls so the next turn can replay them.

  `@tanstack/ai-anthropic`:
  - Captures `signature_delta` stream events and emits the final `STEP_FINISHED` with the signature on `content_block_stop`.
  - Includes thinking blocks with signatures in `formatMessages` for multi-turn history.
  - Passes `betas: ['interleaved-thinking-2025-05-14']` to the `beta.messages.create` call site when a thinking budget is configured. The beta flag is scoped to the streaming path only, so `structuredOutput` (which uses the non-beta `messages.create` endpoint) is unaffected.

  `@tanstack/ai-client`:
  - `ChatClient`'s internal `onThinkingUpdate` wiring is updated for the new `stepId` parameter.

### Patch Changes

- Fixes a race condition in ChatClient.streamResponse() where this.abortController.signal could reference a stale or null controller by the time it is passed to this.connection.connect() ([#377](https://github.com/TanStack/ai/pull/377))

- Updated dependencies [[`a4e2c55`](https://github.com/TanStack/ai/commit/a4e2c55a79490c2245ff2de2d3e1803a533c867b), [`82078bd`](https://github.com/TanStack/ai/commit/82078bdabe28d7d4a15a2847d667f363bf0a9cbe), [`b2d3cc1`](https://github.com/TanStack/ai/commit/b2d3cc131a31c54bd1e5841f958fbe333514e508)]:
  - @tanstack/ai@0.15.0
  - @tanstack/ai-event-client@0.2.9

## 0.8.0

### Minor Changes

- feat: add `useGenerateAudio` hook and streaming support for `generateAudio()` ([#463](https://github.com/TanStack/ai/pull/463))

  Closes the parity gap between audio generation and the other media
  activities (image, speech, video, transcription, summarize):
  - `generateAudio()` now accepts `stream: true`, returning an
    `AsyncIterable<StreamChunk>` that can be piped through
    `toServerSentEventsResponse()`.
  - `AudioGenerateInput` type added to `@tanstack/ai-client`.
  - `useGenerateAudio` hook added to `@tanstack/ai-react`,
    `@tanstack/ai-solid`, and `@tanstack/ai-vue`; matching
    `createGenerateAudio` added to `@tanstack/ai-svelte`. All follow the same
    `{ generate, result, isLoading, error, status, stop, reset }` shape as
    the existing media hooks and support both `connection` (SSE) and
    `fetcher` transports.

### Patch Changes

- fix(ai-client): prevent drainPostStreamActions re-entrancy stealing queued actions ([#429](https://github.com/TanStack/ai/pull/429))

  When multiple client tools complete in the same round, nested `drainPostStreamActions()` calls from `streamResponse()`'s `finally` block could steal queued actions, permanently stalling the conversation. Added a re-entrancy guard and a `shouldAutoSend()` check requiring tool-call parts before triggering continuation.

- Updated dependencies [[`54523f5`](https://github.com/TanStack/ai/commit/54523f5e9a9b4d4ea6c49e4551936bc2cc25593a), [`54523f5`](https://github.com/TanStack/ai/commit/54523f5e9a9b4d4ea6c49e4551936bc2cc25593a), [`af9eb7b`](https://github.com/TanStack/ai/commit/af9eb7bbb875b23b7e99b2e6b743636daad402d1), [`54523f5`](https://github.com/TanStack/ai/commit/54523f5e9a9b4d4ea6c49e4551936bc2cc25593a)]:
  - @tanstack/ai@0.14.0
  - @tanstack/ai-event-client@0.2.8

## 0.7.14

### Patch Changes

- Updated dependencies [[`c1fd96f`](https://github.com/TanStack/ai/commit/c1fd96ffbcee1372ab039127903162bdf5543dd9)]:
  - @tanstack/ai@0.13.0
  - @tanstack/ai-event-client@0.2.7

## 0.7.13

### Patch Changes

- Updated dependencies [[`e32583e`](https://github.com/TanStack/ai/commit/e32583e7612cede932baee6a79355e96e7124d90)]:
  - @tanstack/ai@0.12.0
  - @tanstack/ai-event-client@0.2.6

## 0.7.12

### Patch Changes

- Updated dependencies [[`633a3d9`](https://github.com/TanStack/ai/commit/633a3d93fff27e3de7c10ce0059b2d5d87f33245)]:
  - @tanstack/ai@0.11.1
  - @tanstack/ai-event-client@0.2.5

## 0.7.11

### Patch Changes

- Thread `@tanstack/ai`'s AG-UI-compliant event shapes through the headless chat client: handle flat `RUN_ERROR` payloads, consume `REASONING_*` events, and warn when receiving the deprecated `[DONE]` sentinel. ([#474](https://github.com/TanStack/ai/pull/474))

- fix(ai-client): add `@standard-schema/spec` to devDependencies so the type references `@tanstack/ai` forwards through `InferToolInput` / `InferToolOutput` resolve at build time. Types-only dep with no runtime cost; prevents tool-definition input/output inference from silently collapsing to `unknown` for consumers of `useChat` / `ChatClient`. ([#428](https://github.com/TanStack/ai/pull/428))

- Updated dependencies [[`12d43e5`](https://github.com/TanStack/ai/commit/12d43e55073351a6a2b5b21861b8e28c657b92b7), [`12d43e5`](https://github.com/TanStack/ai/commit/12d43e55073351a6a2b5b21861b8e28c657b92b7)]:
  - @tanstack/ai@0.11.0
  - @tanstack/ai-event-client@0.2.4

## 0.7.10

### Patch Changes

- Updated dependencies [[`c780bc1`](https://github.com/TanStack/ai/commit/c780bc127755ecf7e900343bf0e4d4823ff526ca)]:
  - @tanstack/ai@0.10.3
  - @tanstack/ai-event-client@0.2.3

## 0.7.9

### Patch Changes

- Updated dependencies [[`4445410`](https://github.com/TanStack/ai/commit/44454100e5825f948bab0ce52c57c80d70c0ebe7)]:
  - @tanstack/ai@0.10.2
  - @tanstack/ai-event-client@0.2.2

## 0.7.8

### Patch Changes

- Updated dependencies [[`1d1c58f`](https://github.com/TanStack/ai/commit/1d1c58f33188ff98893edb626efd66ac73b8eadb)]:
  - @tanstack/ai@0.10.1
  - @tanstack/ai-event-client@0.2.1

## 0.7.7

### Patch Changes

- Add code mode and isolate packages for secure AI code execution ([#362](https://github.com/TanStack/ai/pull/362))

  Also includes fixes for Ollama tool call argument streaming and usage
  reporting, OpenAI realtime adapter handling of missing call_id/item_id,
  realtime client guards for missing toolCallId, and new DevtoolsChatMiddleware
  type export from ai-event-client.

- Updated dependencies [[`54abae0`](https://github.com/TanStack/ai/commit/54abae063c91b8b04b91ecb2c6785f5ff9168a7c)]:
  - @tanstack/ai@0.10.0
  - @tanstack/ai-event-client@0.2.0

## 0.7.6

### Patch Changes

- fix: prevent infinite tool call loop when server tool finishes with stop ([#412](https://github.com/TanStack/ai/pull/412))

  When the server-side agent loop executes a tool and the model finishes with `finishReason: 'stop'`, the client no longer auto-sends another request. Previously this caused infinite loops with non-OpenAI providers that respond minimally after tool execution.

## 0.7.5

### Patch Changes

- Updated dependencies [[`26d8243`](https://github.com/TanStack/ai/commit/26d8243bab564a547fed8adb5e129d981ba228ea)]:
  - @tanstack/ai@0.9.2
  - @tanstack/ai-event-client@0.1.4

## 0.7.4

### Patch Changes

- Updated dependencies [[`b8cc69e`](https://github.com/TanStack/ai/commit/b8cc69e15eda49ce68cc48848284b0d74a55a97c)]:
  - @tanstack/ai@0.9.1
  - @tanstack/ai-event-client@0.1.3

## 0.7.3

### Patch Changes

- Updated dependencies [[`842e119`](https://github.com/TanStack/ai/commit/842e119a07377307ba0834ccca0e224dcb5c46ea)]:
  - @tanstack/ai@0.9.0
  - @tanstack/ai-event-client@0.1.2

## 0.7.2

### Patch Changes

- Add an explicit subscription lifecycle to `ChatClient` with `subscribe()`/`unsubscribe()`, `isSubscribed`, `connectionStatus`, and `sessionGenerating`, while keeping request lifecycle state separate from long-lived connection state for durable chat sessions. ([#356](https://github.com/TanStack/ai/pull/356))

  Update the React, Preact, Solid, Svelte, and Vue chat bindings with `live` mode plus reactive subscription/session state, and improve `StreamProcessor` handling for concurrent runs and reconnects so active sessions do not finalize early or duplicate resumed assistant messages.

- Add durable `subscribe()`/`send()` transport support to `ChatClient` while preserving compatibility with existing `connect()` adapters. This also introduces shared generation clients for one-shot streaming tasks and updates the framework wrappers to use the new generation transport APIs. ([#286](https://github.com/TanStack/ai/pull/286))

  Improve core stream processing to better handle concurrent runs and resumed streams so shared sessions stay consistent during reconnects and overlapping generations.

- Updated dependencies [[`64b9cba`](https://github.com/TanStack/ai/commit/64b9cba2ebf89162b809ba575c49ef12c0e87ee7), [`dc53e1b`](https://github.com/TanStack/ai/commit/dc53e1b89fddf6fc744e4788731e8ca64ec3d250)]:
  - @tanstack/ai@0.8.1
  - @tanstack/ai-event-client@0.1.1

## 0.7.1

### Patch Changes

- feat: add middleware system and content guard middleware ([#367](https://github.com/TanStack/ai/pull/367))
  - **@tanstack/ai**: New `@tanstack/ai/middlewares` subpath with composable chat middleware architecture. Includes `contentGuardMiddleware` (delta and buffered strategies) and `toolCacheMiddleware`. Middleware hooks: `onStart`, `onIteration`, `onChunk`, `onToolPhaseComplete`, `onFinish`.
  - **@tanstack/ai-event-client**: Initial release. Extracted `devtoolsMiddleware` from `@tanstack/ai` core into a standalone package for tree-shaking. Emits all DevTools events as an observation-only middleware.
  - **@tanstack/ai-client**: Updated event types for middleware integration.
  - **@tanstack/ai-devtools**: Updated iteration timeline and conversation UI for middleware-aware event handling.

- Updated dependencies [[`f62eeb0`](https://github.com/TanStack/ai/commit/f62eeb0d7efd002894435c7f2c8a9f2790f0b6d7)]:
  - @tanstack/ai@0.8.0
  - @tanstack/ai-event-client@0.1.0

## 0.7.0

### Minor Changes

- feat: add realtime voice chat with OpenAI and ElevenLabs adapters ([#300](https://github.com/TanStack/ai/pull/300))

  Adds realtime voice/text chat capabilities:
  - **@tanstack/ai**: `realtimeToken()` function and shared realtime types (`RealtimeToken`, `RealtimeMessage`, `RealtimeSessionConfig`, `RealtimeStatus`, `RealtimeMode`, `AudioVisualization`, events, and error types)
  - **@tanstack/ai-client**: Framework-agnostic `RealtimeClient` class with connection lifecycle, audio I/O, message state management, tool execution, and `RealtimeAdapter`/`RealtimeConnection` interfaces
  - **@tanstack/ai-openai**: `openaiRealtime()` client adapter (WebRTC) and `openaiRealtimeToken()` server token adapter with support for semantic VAD, multiple voices, and all realtime models
  - **@tanstack/ai-elevenlabs**: `elevenlabsRealtime()` client adapter (WebSocket) and `elevenlabsRealtimeToken()` server token adapter for ElevenLabs conversational AI agents
  - **@tanstack/ai-react**: `useRealtimeChat()` hook with reactive state for status, mode, messages, pending transcripts, audio visualization levels, VAD control, text/image input, and interruptions
  - **Docs**: Realtime Voice Chat guide and full API reference for all realtime classes, interfaces, functions, and type aliases

### Patch Changes

- Updated dependencies [[`86be1c8`](https://github.com/TanStack/ai/commit/86be1c8262bb3176ea786aa0af115b38c3e3f51a)]:
  - @tanstack/ai@0.7.0
  - @tanstack/ai-event-client@0.0.2

## 0.6.0

### Minor Changes

- feat: support server function Response streaming via fetcher ([#327](https://github.com/TanStack/ai/pull/327))

  Generation fetchers can now return a `Response` with an SSE body (e.g., from a TanStack Start server function using `toServerSentEventsResponse()`). When a `Response` is returned, `GenerationClient` and `VideoGenerationClient` automatically parse it as an SSE stream while preserving full type safety on the input.

### Patch Changes

- feat: pass abort signal to generation fetchers and extract GenerationFetcher utility type ([#327](https://github.com/TanStack/ai/pull/327))
  - Generation clients now forward an `AbortSignal` to fetcher functions via an optional `options` parameter, enabling cancellation support when `stop()` is called
  - Introduced `GenerationFetcher<TInput, TResult>` utility type in `@tanstack/ai-client` to centralize the fetcher function signature across all framework integrations
  - All framework hooks/composables (React, Solid, Vue, Svelte) now use the shared `GenerationFetcher` type instead of inline definitions

- Updated dependencies [[`6dfffca`](https://github.com/TanStack/ai/commit/6dfffca99aeac1ada59eb288f8eb09e564d3db1e)]:
  - @tanstack/ai@0.6.3

## 0.5.3

### Patch Changes

- Updated dependencies [[`2ee0b33`](https://github.com/TanStack/ai/commit/2ee0b33386c1f1604c04c1f2f78a859f8a83fd2d)]:
  - @tanstack/ai@0.6.2

## 0.5.2

### Patch Changes

- Fix chained tool approval flows where a second approval arriving during an active continuation stream was silently dropped ([#347](https://github.com/TanStack/ai/pull/347))

## 0.5.1

### Patch Changes

- Updated dependencies [[`d8678e2`](https://github.com/TanStack/ai/commit/d8678e254a8edfa4f95eeb059aa30083c18f52f8)]:
  - @tanstack/ai@0.6.1

## 0.5.0

### Minor Changes

- feat: add custom event dispatch support for tools ([#293](https://github.com/TanStack/ai/pull/293))

  Tools can now emit custom events during execution via `dispatchEvent()`. Custom events are streamed to clients as `custom_event` stream chunks and surfaced through the client chat hook's `onCustomEvent` callback. This enables tools to send progress updates, intermediate results, or any structured data back to the UI during long-running operations.

### Patch Changes

- Refactor CustomEvent property from 'data' to 'value' for AG-UI compliance ([#307](https://github.com/TanStack/ai/pull/307))

- Updated dependencies [[`5aa6acc`](https://github.com/TanStack/ai/commit/5aa6acc1a4faea5346f750322e80984abf2d7059), [`1f800aa`](https://github.com/TanStack/ai/commit/1f800aacf57081f37a075bc8d08ff397cb33cbe9)]:
  - @tanstack/ai@0.6.0

## 0.4.5

### Patch Changes

- Updated dependencies [[`58702bc`](https://github.com/TanStack/ai/commit/58702bcaad31c46f8fd747b2f0e1daff2003beb9)]:
  - @tanstack/ai@0.5.1

## 0.4.4

### Patch Changes

- fix(ai, ai-client, ai-anthropic, ai-gemini): fix multi-turn conversations failing after tool calls ([#275](https://github.com/TanStack/ai/pull/275))

  **Core (@tanstack/ai):**
  - Lazy assistant message creation: `StreamProcessor` now defers creating the assistant message until the first content-bearing chunk arrives (text, tool call, thinking, or error), eliminating empty `parts: []` messages from appearing during auto-continuation when the model returns no content
  - Add `prepareAssistantMessage()` (lazy) alongside deprecated `startAssistantMessage()` (eager, backwards-compatible)
  - Add `getCurrentAssistantMessageId()` to check if a message was created
  - **Rewrite `uiMessageToModelMessages()` to preserve part ordering**: the function now walks parts sequentially instead of separating by type, producing correctly interleaved assistant/tool messages (text1 + toolCall1 → toolResult1 → text2 + toolCall2 → toolResult2) instead of concatenating all text and batching all tool calls. This fixes multi-round tool flows where the model would see garbled conversation history and re-call tools unnecessarily.
  - Deduplicate tool result messages: when a client tool has both a `tool-result` part and a `tool-call` part with `output`, only one `role: 'tool'` message is emitted per tool call ID

  **Client (@tanstack/ai-client):**
  - Update `ChatClient.processStream()` to use lazy assistant message creation, preventing UI flicker from empty messages being created then removed

  **Anthropic:**
  - Fix consecutive user-role messages violating Anthropic's alternating role requirement by merging them in `formatMessages`
  - Deduplicate `tool_result` blocks with the same `tool_use_id`
  - Filter out empty assistant messages from conversation history
  - Suppress duplicate `RUN_FINISHED` event from `message_stop` when `message_delta` already emitted one
  - Fix `TEXT_MESSAGE_END` incorrectly emitting for `tool_use` content blocks
  - Add Claude Opus 4.6 model support with adaptive thinking and effort parameter

  **Gemini:**
  - Fix consecutive user-role messages violating Gemini's alternating role requirement by merging them in `formatMessages`
  - Deduplicate `functionResponse` parts with the same name (tool call ID)
  - Filter out empty model messages from conversation history

- Updated dependencies [[`5d98472`](https://github.com/TanStack/ai/commit/5d984722e1f84725e3cfda834fbda3d0341ecedd), [`5d98472`](https://github.com/TanStack/ai/commit/5d984722e1f84725e3cfda834fbda3d0341ecedd)]:
  - @tanstack/ai@0.5.0

## 0.4.3

### Patch Changes

- Updated dependencies [[`6f886e9`](https://github.com/TanStack/ai/commit/6f886e96f2478374520998395357fdf3aa9149ab)]:
  - @tanstack/ai@0.4.2

## 0.4.2

### Patch Changes

- Updated dependencies [[`6e1bb50`](https://github.com/TanStack/ai/commit/6e1bb5097178a6ad795273ca715f1e09d3f5a006)]:
  - @tanstack/ai@0.4.1

## 0.4.1

### Patch Changes

- add multiple modalities support to the client ([#263](https://github.com/TanStack/ai/pull/263))

- Updated dependencies [[`0158d14`](https://github.com/TanStack/ai/commit/0158d14df00639ff5325680ae91b7791c189e60f)]:
  - @tanstack/ai@0.4.0

## 0.4.0

### Minor Changes

- Added status property to useChat to track the generation lifecycle (ready, submitted, streaming, error) ([#247](https://github.com/TanStack/ai/pull/247))

### Patch Changes

- fix: improve tool execution reliability and prevent race conditions ([#258](https://github.com/TanStack/ai/pull/258))
  - Fix client tool execution race conditions by tracking pending tool executions
  - Prevent duplicate continuation attempts with continuationPending flag
  - Guard against concurrent stream processing in streamResponse
  - Add approval info to ToolCall type for server-side decision tracking
  - Include approval info in model message conversion for approval workflows
  - Check ModelMessage format for approval info extraction in chat activity

  This change improves the reliability of tool execution, especially for:
  - Client tools with async execute functions
  - Approval-based tool workflows
  - Sequential tool execution scenarios

- Updated dependencies [[`230bab6`](https://github.com/TanStack/ai/commit/230bab6417c8ff2c25586a12126c85e27dd7bc15)]:
  - @tanstack/ai@0.3.1

## 0.3.0

### Minor Changes

- feat: Add AG-UI protocol events to streaming system ([#244](https://github.com/TanStack/ai/pull/244))

  All text adapters now emit AG-UI protocol events only:
  - `RUN_STARTED` / `RUN_FINISHED` - Run lifecycle events
  - `TEXT_MESSAGE_START` / `TEXT_MESSAGE_CONTENT` / `TEXT_MESSAGE_END` - Text message streaming
  - `TOOL_CALL_START` / `TOOL_CALL_ARGS` / `TOOL_CALL_END` - Tool call streaming

  Only AG-UI event types are supported; previous legacy chunk formats (`content`, `tool_call`, `done`, etc.) are no longer accepted.

### Patch Changes

- Updated dependencies [[`e52135f`](https://github.com/TanStack/ai/commit/e52135f6ec3285227679411636e208ae84a408d7)]:
  - @tanstack/ai@0.3.0

## 0.2.2

### Patch Changes

- Updated dependencies [[`7573619`](https://github.com/TanStack/ai/commit/7573619a234d1a50bd2ac098d64524447ebc5869)]:
  - @tanstack/ai@0.2.2

## 0.2.1

### Patch Changes

- fix up readmes ([#188](https://github.com/TanStack/ai/pull/188))

- Updated dependencies [[`181e0ac`](https://github.com/TanStack/ai/commit/181e0acdfb44b27db6cf871b36593c0f867cadf9), [`181e0ac`](https://github.com/TanStack/ai/commit/181e0acdfb44b27db6cf871b36593c0f867cadf9)]:
  - @tanstack/ai@0.2.1

## 0.2.0

### Minor Changes

- Standard schema / standard json schema support for TanStack AI ([#165](https://github.com/TanStack/ai/pull/165))

### Patch Changes

- Updated dependencies [[`c5df33c`](https://github.com/TanStack/ai/commit/c5df33c2d3e72c3332048ffe7c64a553e5ea86fb)]:
  - @tanstack/ai@0.2.0

## 0.1.0

### Minor Changes

- Split up adapters for better tree shaking into separate functionalities ([#137](https://github.com/TanStack/ai/pull/137))

### Patch Changes

- Updated dependencies [[`8d77614`](https://github.com/TanStack/ai/commit/8d776146f94ffd1579e1ab01b26dcb94d1bb3092)]:
  - @tanstack/ai@0.1.0

## 0.0.3

### Patch Changes

- Updated dependencies [[`52c3172`](https://github.com/TanStack/ai/commit/52c317244294a75b0c7f5e6cafc8583fbb6abfb7)]:
  - @tanstack/ai@0.0.3

## 0.0.2

### Patch Changes

- Made the fetch client used by the default connection adapters configurable. ([#80](https://github.com/TanStack/ai/pull/80))

- Updated dependencies [[`64fda55`](https://github.com/TanStack/ai/commit/64fda55f839062bc67b8c24850123e879fdbf0b3)]:
  - @tanstack/ai@0.0.2

## 0.0.1

### Patch Changes

- Initial release of TanStack AI ([#72](https://github.com/TanStack/ai/pull/72))

- Updated dependencies [[`a9b54c2`](https://github.com/TanStack/ai/commit/a9b54c21282d16036a427761e0784b159a6f2d99)]:
  - @tanstack/ai@0.0.1
