/**
 * Public entry for `@tanstack/ai-persistence-drizzle/sqlite`.
 *
 * Implementation lives in `sqlite/factory.ts`.
 */
export {
  createDefaultSqliteSchema,
  ensureSqliteTables,
  sqlitePersistence,
} from './sqlite/factory'
export type { SqlitePersistenceOptions } from './sqlite/factory'

export { sandboxes } from './sqlite/default-schema'
