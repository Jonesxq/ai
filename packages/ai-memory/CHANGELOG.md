# @tanstack/ai-memory

## 0.1.0

### Minor Changes

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

- [#541](https://github.com/TanStack/ai/pull/541) [`347b61b`](https://github.com/TanStack/ai/commit/347b61bc788bb816bbd12287c1a426ca7def00f4) - **Add server-side memory via a `recall`/`save` adapter contract in `@tanstack/ai-memory`.**

  Memory is now a single, provider-agnostic contract with two verbs — `recall` and
  `save` — which is the shape every memory backend (in-process, Redis, and hosted
  vendors) naturally exposes. `memoryMiddleware` recalls relevant memory into the
  system prompt (and optionally injects vendor tools) before the model runs, then
  defers `save` of the finished turn via `ctx.defer` so streaming is never blocked.
  Extraction, ranking, and rendering live inside each adapter — the middleware is thin.

  `@tanstack/ai-memory` (new package) — everything ships here:
  - Root: `memoryMiddleware`, the `MemoryAdapter` contract
    (`recall` / `save` / optional `inspect` / `listFacts`), and the `MemoryScope` /
    `MemoryTurn` / `RecallResult` / `SaveReceipt` types.
  - `@tanstack/ai-memory/in-memory` → `inMemory()` — zero-dependency adapter for dev,
    tests, and single-process demos. Pass an `embedder` for semantic scoring and/or an
    `extract` function to persist derived facts.
  - `@tanstack/ai-memory/redis` → `redis({ redis, prefix? })` — production adapter for
    plain Redis. `ioredis` wires in directly; `redis` (node-redis v4+) via the
    `fromNodeRedis(client)` wrapper. Both are optional peer dependencies.
  - `@tanstack/ai-memory/hindsight` → `hindsight()`, `@tanstack/ai-memory/mem0` →
    `mem0()`, `@tanstack/ai-memory/honcho` → `honcho()` — hosted-vendor adapters. Their
    SDKs (`@vectorize-io/hindsight-client`, `@honcho-ai/sdk`) are optional peers loaded
    lazily; mem0 talks to its server over plain HTTP (no SDK). Vendors can expose LLM
    tools through `recall` (e.g. hindsight's retain/recall/reflect).
  - A shared `recall`/`save` contract-test suite (`@tanstack/ai-memory/tests/contract`)
    that any adapter — including third-party ones — can run.

  `@tanstack/ai`:
  - **Removes the (unreleased) `@tanstack/ai/memory` subpath.** The middleware,
    contract, and helpers all moved to `@tanstack/ai-memory`.

  `@tanstack/ai-event-client`:
  - The five `memory:*` devtools events (`memory:retrieve:started` / `:completed`,
    `memory:persist:started` / `:completed`, `memory:error`) now carry recall/save
    payloads (adapter id, fragment/receipt counts, `phase: 'recall' | 'save'`).

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

### Patch Changes

- [#984](https://github.com/TanStack/ai/pull/984) [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a) - **Make every bundled Agent Skill discoverable by TanStack Intent.**

  Intent finds skills by scanning `node_modules` for packages that carry the
  `tanstack-intent` keyword, and can only load what npm actually publishes. Three
  packages shipped skills that failed one half of that contract:
  - `@tanstack/ai-mcp` wrote its skill into a `skills/` directory that was missing
    from `files`, so it was never published at all.
  - `@tanstack/ai-memory` and `@tanstack/ai-sandbox` published their skills but
    lacked the keyword, so Intent never looked at them.

  All three now publish `skills` and carry the keyword, matching `@tanstack/ai`,
  `@tanstack/ai-code-mode`, and `@tanstack/ai-persistence`.

  The client persistence skill also moves from `@tanstack/ai-persistence` to
  `@tanstack/ai` as `ai-core/client-persistence`. It teaches
  `localStoragePersistence` / `sessionStoragePersistence` / `indexedDBPersistence`
  and the `persistence` option on `useChat` — all of which live in the framework
  packages, not in `@tanstack/ai-persistence`. An app doing browser-only
  persistence never installs that package, so the guidance was unreachable for
  exactly the people who needed it, and `ai-core` routed to a path that did not
  exist on disk. Skills now follow the code that owns them.

- Updated dependencies [[`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`347b61b`](https://github.com/TanStack/ai/commit/347b61bc788bb816bbd12287c1a426ca7def00f4), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a), [`3301398`](https://github.com/TanStack/ai/commit/330139878958fc5c5c167a69347c884fa35b792a), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`478a4da`](https://github.com/TanStack/ai/commit/478a4da3756e0de09548f2902da3b45748c27b52), [`347b61b`](https://github.com/TanStack/ai/commit/347b61bc788bb816bbd12287c1a426ca7def00f4), [`cc88874`](https://github.com/TanStack/ai/commit/cc88874ecb0639daa1f8a8c32be5dcc9b2749371), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`7c7aa09`](https://github.com/TanStack/ai/commit/7c7aa09a7402b45e6285ebc78a606131aec3e288), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5), [`4ce7600`](https://github.com/TanStack/ai/commit/4ce7600d5b543d4b7e3bd6d63cdf5ecf91cdeeaa), [`4ab149f`](https://github.com/TanStack/ai/commit/4ab149fd46a1cf55691266cdd118fdc9999c0b2a), [`996a980`](https://github.com/TanStack/ai/commit/996a9802b4dd1edf5301ad10a88c5e994367d7a5)]:
  - @tanstack/ai@0.43.0
  - @tanstack/ai-event-client@0.7.0
