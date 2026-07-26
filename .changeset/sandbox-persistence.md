---
'@tanstack/ai': minor
'@tanstack/ai-sandbox': minor
'@tanstack/ai-persistence': minor
---

Add durable **sandbox persistence**: cross-process / multi-instance resume for `@tanstack/ai-sandbox`, provided by the same `withPersistence` used for chat.

`withSandbox` consumes `SandboxStore` (which sandbox to resume) and `LockStore` (mutual exclusion around ensure) as optional capabilities, defaulting to in-memory (single-process). This makes them durable without a sandbox-specific middleware:

- `withPersistence` now provides the `SandboxStoreCapability` (and the shared `LocksCapability`) whenever its store set includes them. Compose `[withPersistence(persistence), withSandbox(sandbox)]`.
- `AIPersistenceStores` gains an optional `sandbox?: SandboxStore`. `memoryPersistence()` includes an in-memory sandbox store; any adapter can add one by implementing `SandboxStore` and putting it on the `stores` bag.
- Multi-instance deployments pair the store with a distributed `LockStore` via `withLocks`; the in-memory lock is correct within one process only.

**Shared tokens in core.** `SandboxStore` / `SandboxRecord` / `SandboxStoreCapability` / `InMemorySandboxStore` and the `LockStore` / `LocksCapability` / `InMemoryLockStore` primitives now live in core `@tanstack/ai` (their neutral home). `@tanstack/ai-sandbox` and `@tanstack/ai-persistence` re-export them, so one shared token reference lets a persistence-provided store and lock reach `withSandbox` with no dependency between the two packages. A `SandboxStore` conformance testkit is exported from `@tanstack/ai-sandbox/testkit` (`runSandboxStoreConformance`); every backend should run it.
