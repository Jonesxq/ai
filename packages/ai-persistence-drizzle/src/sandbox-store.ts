/**
 * Durable {@link SandboxStore} over a Drizzle database.
 *
 * Backs `@tanstack/ai-sandbox`'s resume-or-create ensure: maps a compound
 * sandbox key to the provider sandbox (and latest snapshot) that should be
 * resumed. Independent of the chat schema contract — pass the sandboxes table
 * explicitly (or use the stock default from {@link createDefaultSqliteSchema}
 * / {@link createDefaultPgSchema} when you opt into sandbox columns).
 *
 * Multi-instance correctness additionally needs a distributed lock (e.g. the
 * Cloudflare Durable Object lock); this store only persists the mapping.
 */
import { eq } from 'drizzle-orm'
import type { SandboxRecord, SandboxStore } from '@tanstack/ai'
import type { DrizzleSqliteDb } from './core/stores'
import type { AnySQLiteColumn, SQLiteTable } from 'drizzle-orm/sqlite-core'
import type { AnyPgColumn, PgTable } from 'drizzle-orm/pg-core'

/** Column data shapes for a sandboxes table. */
export interface SandboxTableShapes {
  key: string
  provider: string
  providerSandboxId: string
  latestSnapshotId: string
  threadId: string
  latestRunId: string
  updatedAt: number
}

/** SQLite sandboxes table projection. */
export type SqliteSandboxTable = SQLiteTable & {
  [ColumnKey in keyof SandboxTableShapes]: AnySQLiteColumn<{
    data: SandboxTableShapes[ColumnKey]
  }>
}

/** Postgres sandboxes table projection. */
export type PgSandboxTable = PgTable & {
  [ColumnKey in keyof SandboxTableShapes]: AnyPgColumn<{
    data: SandboxTableShapes[ColumnKey]
  }>
}

export type SandboxTable = SqliteSandboxTable | PgSandboxTable

type SandboxRow = {
  key: string
  provider: string
  providerSandboxId: string
  latestSnapshotId: string | null
  threadId: string
  latestRunId: string | null
  updatedAt: number
}

function mapSandbox(row: SandboxRow): SandboxRecord {
  return {
    key: row.key,
    provider: row.provider,
    providerSandboxId: row.providerSandboxId,
    ...(row.latestSnapshotId != null
      ? { latestSnapshotId: row.latestSnapshotId }
      : {}),
    threadId: row.threadId,
    ...(row.latestRunId != null ? { latestRunId: row.latestRunId } : {}),
    updatedAt: row.updatedAt,
  }
}

/**
 * Wire a durable {@link SandboxStore} over a sandboxes table.
 *
 * Chat-only schemas omit this table; only apps that compose sandbox
 * persistence need it.
 */
export function createDrizzleSandboxStore(
  db: DrizzleSqliteDb,
  sandboxes: SandboxTable,
): SandboxStore {
  return {
    async get(key) {
      const rows = (await db
        .select()
        .from(sandboxes as never)
        .where(eq(sandboxes.key as never, key))) as Array<SandboxRow>
      const row = rows[0]
      return row ? mapSandbox(row) : null
    },
    async upsert(record) {
      const values = {
        key: record.key,
        provider: record.provider,
        providerSandboxId: record.providerSandboxId,
        latestSnapshotId: record.latestSnapshotId ?? null,
        threadId: record.threadId,
        latestRunId: record.latestRunId ?? null,
        updatedAt: record.updatedAt,
      }
      await db
        .insert(sandboxes as never)
        .values(values as never)
        .onConflictDoUpdate({
          target: sandboxes.key as never,
          set: {
            provider: values.provider,
            providerSandboxId: values.providerSandboxId,
            latestSnapshotId: values.latestSnapshotId,
            threadId: values.threadId,
            latestRunId: values.latestRunId,
            updatedAt: values.updatedAt,
          } as never,
        })
    },
    async delete(key) {
      await db.delete(sandboxes as never).where(eq(sandboxes.key as never, key))
    },
  }
}
