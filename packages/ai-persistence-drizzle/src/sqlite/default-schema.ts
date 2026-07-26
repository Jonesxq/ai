/**
 * Default SQLite table definitions for TanStack AI state stores.
 *
 * Prefer owning this shape in your project via `tanstack-ai-drizzle-schema` and
 * generating DDL with **your** drizzle-kit journal. This factory is the runtime
 * convenience default used by {@link sqlitePersistence} and by apps that want
 * the stock tables without copying a file first.
 *
 * This package does **not** ship SQL migrations. Schema ownership and
 * migration generation live in the application.
 *
 * **Source of truth for the Postgres projection** — edit this file (and the
 * SQLite CLI asset), then run `pnpm codegen:pg` to regenerate `src/pg/`.
 */
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core'
import type { InterruptRecord, RunStatus } from '@tanstack/ai-persistence'
import type { ModelMessage, TokenUsage } from '@tanstack/ai'
import type { TanstackAiSqliteSchema } from '../core/schema-contract'

/** Thread message history (`MessageStore`). */
export const messages = sqliteTable('messages', {
  threadId: text('thread_id').primaryKey(),
  messagesJson: text('messages_json', { mode: 'json' })
    .$type<Array<ModelMessage>>()
    .notNull(),
})

/** Run lifecycle records (`RunStore`). */
export const runs = sqliteTable('runs', {
  runId: text('run_id').primaryKey(),
  threadId: text('thread_id').notNull(),
  status: text('status').$type<RunStatus>().notNull(),
  startedAt: integer('started_at').notNull(),
  finishedAt: integer('finished_at'),
  error: text('error'),
  usageJson: text('usage_json', { mode: 'json' }).$type<TokenUsage>(),
})

/** Interrupt / approval records (`InterruptStore`). */
export const interrupts = sqliteTable(
  'interrupts',
  {
    interruptId: text('interrupt_id').primaryKey(),
    runId: text('run_id').notNull(),
    threadId: text('thread_id').notNull(),
    status: text('status').$type<InterruptRecord['status']>().notNull(),
    requestedAt: integer('requested_at').notNull(),
    resolvedAt: integer('resolved_at'),
    payloadJson: text('payload_json', { mode: 'json' })
      .$type<Record<string, unknown>>()
      .notNull(),
    responseJson: text('response_json', { mode: 'json' }).$type<unknown>(),
  },
  // The stores list interrupts by thread and by run (`list*`,
  // `listPending*`); index both foreign lookups.
  (table) => [
    index('interrupts_thread_id_idx').on(table.threadId),
    index('interrupts_run_id_idx').on(table.runId),
  ],
)

/** Scoped key/value metadata (`MetadataStore`). */
export const metadata = sqliteTable(
  'metadata',
  {
    scope: text('scope').notNull(),
    key: text('key').notNull(),
    valueJson: text('value_json', { mode: 'json' }).$type<unknown>().notNull(),
  },
  (table) => [primaryKey({ columns: [table.scope, table.key] })],
)

/**
 * Persisted sandbox resume records (`@tanstack/ai-sandbox`'s `SandboxStore`).
 * Keyed by the compound sandbox key; small metadata only (no blobs).
 *
 * **Not** part of {@link TanstackAiSqliteSchema} / the chat BYO contract —
 * chat-only apps never need this table. Pass it to
 * {@link createDrizzleSandboxStore} when you want durable sandbox resume.
 */
export const sandboxes = sqliteTable('sandboxes', {
  key: text('key').primaryKey(),
  provider: text('provider').notNull(),
  providerSandboxId: text('provider_sandbox_id').notNull(),
  latestSnapshotId: text('latest_snapshot_id'),
  threadId: text('thread_id').notNull(),
  latestRunId: text('latest_run_id'),
  updatedAt: integer('updated_at').notNull(),
})

/**
 * Build a fresh copy of the default SQLite schema tables.
 *
 * Pass the result to {@link drizzlePersistence} or {@link sqlitePersistence},
 * or prefer the file emitted by `tanstack-ai-drizzle-schema` when you want
 * drizzle-kit to own DDL in your repo.
 */
export function createDefaultSqliteSchema(): TanstackAiSqliteSchema {
  return {
    messages,
    runs,
    interrupts,
    metadata,
  }
}
