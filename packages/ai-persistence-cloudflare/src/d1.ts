import { drizzle } from 'drizzle-orm/d1'
import {
  createDefaultSqliteSchema,
  createDrizzleSandboxStore,
  defaultSqliteSandboxes,
  drizzlePersistence,
} from '@tanstack/ai-persistence-drizzle'
import type { SandboxStore } from '@tanstack/ai'

/**
 * Create the structured chat stores over a Cloudflare D1 binding.
 *
 * Thin wrapper: stock SQLite schema + `drizzle-orm/d1` +
 * {@link drizzlePersistence}. This package does **not** ship or apply DDL —
 * migrate tables with your own drizzle-kit journal (or equivalent SQL matching
 * the default schema) before use. For custom table names/columns, own a schema
 * from `tanstack-ai-drizzle-schema` and call `drizzlePersistence` yourself.
 */
export function createD1Stores(d1: D1Database) {
  const schema = createDefaultSqliteSchema()
  const persistence = drizzlePersistence(drizzle(d1, { schema }), {
    provider: 'sqlite',
    schema,
  })
  return {
    messages: persistence.stores.messages,
    runs: persistence.stores.runs,
    interrupts: persistence.stores.interrupts,
    metadata: persistence.stores.metadata,
  }
}

/**
 * Durable {@link SandboxStore} over a migrated Cloudflare D1 binding (delegates
 * to the Drizzle sandbox store). Pair with `createDurableObjectLockStore` for a
 * multi-instance-correct sandbox resume on the edge. The `sandboxes` table is
 * **not** part of the chat BYO schema — migrate it separately (or use the stock
 * definition from `@tanstack/ai-persistence-drizzle`).
 */
export function createD1SandboxStore(d1: D1Database): SandboxStore {
  return createDrizzleSandboxStore(
    drizzle(d1, { schema: { sandboxes: defaultSqliteSandboxes } }),
    defaultSqliteSandboxes,
  )
}
