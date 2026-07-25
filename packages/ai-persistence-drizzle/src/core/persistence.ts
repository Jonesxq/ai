/**
 * Wire TanStack AI persistence stores over a migrated Drizzle database.
 *
 * Shared entry used by both dialect folders. Schema-first: this package does
 * **not** ship SQL migrations — pass a project-owned schema (or a default
 * factory from `sqlite/` / `pg/`).
 */
import { is } from 'drizzle-orm'
import { PgDatabase } from 'drizzle-orm/pg-core'
import { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core'
import { assertTanstackAiSchema } from './schema-contract'
import {
  createInterruptStore,
  createMessageStore,
  createMetadataStore,
  createRunStore,
} from './stores'
import type { PgQueryResultHKT } from 'drizzle-orm/pg-core'
import type { ChatPersistence } from '@tanstack/ai-persistence'
import type {
  TanstackAiPgSchema,
  TanstackAiSqliteSchema,
} from './schema-contract'
import type { DrizzleSqliteDb, TanstackAiTables } from './stores'

/**
 * Any Drizzle Postgres database (node-postgres, postgres.js, neon, pglite, …).
 *
 * Typed as the schema-agnostic slice of the query builder the stores actually
 * use, so a BYO `db` constructed with any `{ schema }` is assignable
 * regardless of its `TFullSchema`.
 */
export type DrizzlePgDb = Pick<
  PgDatabase<PgQueryResultHKT>,
  'select' | 'insert' | 'update' | 'delete'
>

export interface SqlitePersistenceConfig {
  /** The database dialect of `db` and `schema`. */
  provider: 'sqlite'
  /**
   * Your TanStack AI schema tables. Emit a starter with
   * `tanstack-ai-drizzle-schema`, add it to drizzle-kit, generate migrations
   * in your project, and pass the module here. Table/column database names are
   * yours (including drizzle `casing`); extra app-owned columns are fine when
   * nullable or defaulted.
   *
   * For the stock tables without a project file, use
   * {@link createDefaultSqliteSchema}.
   */
  schema: TanstackAiSqliteSchema
}

export interface PgPersistenceConfig {
  /** The database dialect of `db` and `schema`. */
  provider: 'pg'
  /**
   * Your TanStack AI schema tables. Emit a starter with
   * `tanstack-ai-drizzle-schema --dialect pg`, add it to drizzle-kit, generate
   * migrations in your project, and pass the module here. Table/column
   * database names are yours (including drizzle `casing`); extra app-owned
   * columns are fine when nullable or defaulted.
   *
   * For the stock tables without a project file, use
   * {@link createDefaultPgSchema}.
   */
  schema: TanstackAiPgSchema
}

export type DrizzlePersistenceOptions =
  | SqlitePersistenceConfig
  | PgPersistenceConfig

/** Packaged Drizzle backend: full {@link ChatPersistence} (messages + runs + …). */
export type DrizzlePersistence = ChatPersistence

/**
 * Wire TanStack AI persistence stores over a migrated Drizzle database.
 *
 * Returns {@link ChatPersistence}. `provider` declares the dialect; `db` and
 * `schema` must match it (checked at compile time by the overloads and at
 * runtime by the schema assertion). `schema` is required — this package never
 * applies bundled DDL. Own migrations via drizzle-kit (after emitting the
 * schema), or bootstrap a known schema locally with {@link ensureSqliteTables}
 * / {@link ensurePgTables}.
 *
 * State stores only — locks are a separate concern. For multi-instance
 * coordination use `withLocks` with a distributed `LockStore` (for example
 * `createDurableObjectLockStore` from `@tanstack/ai-persistence-cloudflare`).
 */
export function drizzlePersistence(
  db: DrizzleSqliteDb,
  options: SqlitePersistenceConfig,
): ChatPersistence
export function drizzlePersistence(
  db: DrizzlePgDb,
  options: PgPersistenceConfig,
): ChatPersistence
export function drizzlePersistence(
  db: DrizzleSqliteDb | DrizzlePgDb,
  options: DrizzlePersistenceOptions,
): ChatPersistence {
  assertTanstackAiSchema(options.schema, options.provider)
  // The overloads guarantee db/provider/schema agree for typed callers;
  // re-verify the db dialect at runtime for anyone calling through `any`.
  const dialectOk =
    options.provider === 'pg' ? is(db, PgDatabase) : is(db, BaseSQLiteDatabase)
  if (!dialectOk) {
    throw new TypeError(
      `drizzlePersistence: provider is '${options.provider}' but \`db\` is not a Drizzle ${
        options.provider === 'pg' ? 'Postgres' : 'SQLite'
      } database.`,
    )
  }
  // THE SEAM. The stores are implemented once against the SQLite builder
  // types, but the Postgres and SQLite query builders share the exact method
  // surface the stores use (select/insert/update/delete, onConflictDo*,
  // eq/and/asc), and the generated SQL dialect comes from the runtime
  // db/table objects — which the checks above have just proven match
  // `provider`. TypeScript cannot correlate the db/schema unions per provider
  // (no correlated union types), so the pg pair is re-faced onto the SQLite
  // signatures here — the single place dialect typing is erased. The pg
  // conformance suite runs the result against a real Postgres engine.
  const tables = options.schema as TanstackAiTables
  const storeDb = db as DrizzleSqliteDb
  return {
    stores: {
      messages: createMessageStore(storeDb, tables),
      runs: createRunStore(storeDb, tables),
      interrupts: createInterruptStore(storeDb, tables),
      metadata: createMetadataStore(storeDb, tables),
    },
  }
}
