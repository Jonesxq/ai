/**
 * Drizzle-backed persistence for TanStack AI (SQLite and Postgres).
 *
 * Schema-first: this package does **not** ship SQL migrations. Emit a schema
 * into your project with `tanstack-ai-drizzle-schema`, let **your** drizzle-kit
 * journal own the DDL, then pass the schema into {@link drizzlePersistence}
 * together with the matching `provider`.
 *
 * Package layout:
 * - `core/` — shared stores, schema contract, persistence wiring
 * - `sqlite/` — SQLite schema (source of truth), ensure, Node factory
 * - `pg/` — Postgres schema (codegen from sqlite), ensure
 *
 * This root entry is safe to import in edge runtimes. Node's SQLite
 * convenience factory (default schema + optional runtime table bootstrap)
 * lives at `@tanstack/ai-persistence-drizzle/sqlite`.
 */
export { drizzlePersistence } from './core/persistence'
export type {
  DrizzlePgDb,
  DrizzlePersistence,
  DrizzlePersistenceOptions,
  PgPersistenceConfig,
  SqlitePersistenceConfig,
} from './core/persistence'

export { createDefaultSqliteSchema } from './sqlite/default-schema'
export { createDefaultPgSchema } from './pg/default-schema'
export { ensureSqliteTables } from './sqlite/ensure-tables'
export { ensurePgTables } from './pg/ensure-tables'
export {
  drizzleSchemaFilename,
  drizzleSchemaSources,
  drizzleSchemaSource,
} from './core/schema-source'
export {
  DrizzleSchemaError,
  assertTanstackAiSchema,
} from './core/schema-contract'
export type {
  DrizzleProvider,
  TanstackAiPgSchema,
  TanstackAiSqliteSchema,
  TanstackAiTableShapes,
  TanstackAiSchema,
} from './core/schema-contract'
export type { DrizzleSqliteDb, DrizzleDb } from './core/stores'
