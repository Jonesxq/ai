import { drizzle } from 'drizzle-orm/d1'
import {
  createDefaultSqliteSchema,
  drizzlePersistence,
} from '@tanstack/ai-persistence-drizzle'

/**
 * Create the structured stores over a Cloudflare D1 binding.
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
