---
'@tanstack/ai-persistence-drizzle': minor
'@tanstack/ai-persistence-prisma': minor
'@tanstack/ai-persistence-cloudflare': minor
---

Add `SandboxStore` implementations to the packaged persistence backends, so durable sandbox resume works out of the box on each.

- `@tanstack/ai-persistence-drizzle` — `createDrizzleSandboxStore(db, sandboxesTable)`, plus a stock `sandboxes` table in the SQLite and Postgres default schemas. `sqlitePersistence({ url })` bootstraps it alongside the chat tables and returns a persistence whose `stores.sandbox` is ready for `withPersistence`.
- `@tanstack/ai-persistence-prisma` — `createPrismaSandboxStore(prisma)` against a new `Sandbox` model in the emitted fragment. The delegate resolves lazily, so a chat-only client that never adds the model keeps working.
- `@tanstack/ai-persistence-cloudflare` — `createD1SandboxStore(d1)`, delegating to the Drizzle store. Pair it with the package's Durable Object lock, which doubles as the distributed sandbox lock — at the edge every run can hit a different isolate, so that lock is what makes resume correct rather than merely likely.

Each backend runs the `runSandboxStoreConformance` testkit from `@tanstack/ai-sandbox/testkit`.

Writing your own adapter instead? `SandboxStore` is a three-method interface (`get` / `upsert` / `delete`) — implement it and put it on your `stores` bag under `sandbox`. See [Sandbox Persistence](https://tanstack.com/ai/latest/docs/sandbox/persistence).
