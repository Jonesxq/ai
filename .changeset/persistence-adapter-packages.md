---
'@tanstack/ai-persistence-drizzle': minor
'@tanstack/ai-persistence-prisma': minor
'@tanstack/ai-persistence-cloudflare': minor
---

Add optional packaged persistence backends for `@tanstack/ai-persistence`.

Each implements the four store contracts and passes the shared conformance testkit, so it is a drop-in for `withPersistence` — the same thing you would get by writing the adapter yourself, pre-built and maintained here.

- `@tanstack/ai-persistence-drizzle` — Drizzle-backed stores for SQLite and Postgres behind one `drizzlePersistence(db, { provider, schema })` entry (plus a `node:sqlite` convenience factory at `/sqlite`), sharing one bring-your-own-schema contract. Get the tables into your drizzle-kit journal by re-exporting the `/sqlite-schema` or `/pg-schema` subpath (stock tables, tracks upgrades) or by emitting an owned starter with the dialect-aware schema CLI (renames, extra columns, index tuning).
- `@tanstack/ai-persistence-prisma` — Prisma-backed stores with a models CLI that emits a provider-neutral schema fragment. Works with both Prisma 6 (`prisma-client-js`) and Prisma 7 (`prisma-client`): the client argument is typed structurally, so it accepts a client generated to any output path.
- `@tanstack/ai-persistence-cloudflare` — D1-backed stores (delegating to the Drizzle backend) plus a Durable-Object lock store for cross-instance locking.

These are a convenience, not a requirement. `@tanstack/ai-persistence` ships the contracts and the conformance testkit precisely so an application can implement the stores against a database it already owns; see [Build Your Own Adapter](https://tanstack.com/ai/latest/docs/persistence/build-your-own-adapter) and the Agent Skills the package ships for the Drizzle, Prisma, and Cloudflare recipes. Reach for a package when the stock schema suits you and you would rather not own the code; write the adapter when your schema, tenancy, or database is your own.

Also adds `examples/persistent-chat-drizzle` and `examples/persistent-chat-prisma`, which demonstrate each package end to end alongside the hand-rolled `node:sqlite` backend in `examples/ts-react-chat`.
