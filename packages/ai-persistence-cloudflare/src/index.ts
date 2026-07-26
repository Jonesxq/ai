import { createD1Stores } from './d1'
import type { ChatPersistence } from '@tanstack/ai-persistence'

export { createD1Stores, createD1SandboxStore } from './d1'
export {
  CloudflareLockDurableObject,
  createDurableObjectLockStore,
} from './locks'
export type { DurableObjectLockStoreOptions } from './locks'
export type {
  DurableObjectNamespaceBinding,
  DurableObjectStubBinding,
  LockDurableObjectState,
  LockDurableObjectStorage,
} from './bindings'

/**
 * D1-backed **chat** state stores (`messages`, `runs`, `interrupts`, `metadata`).
 *
 * Thin convenience over `@tanstack/ai-persistence-drizzle` + `drizzle-orm/d1`.
 * Schema DDL is **not** owned here — emit a SQLite schema with
 * `tanstack-ai-drizzle-schema` (or re-export
 * `@tanstack/ai-persistence-drizzle/sqlite-schema`), migrate with your
 * drizzle-kit journal / Wrangler `migrations_dir`, then bind D1.
 *
 * Locks are a separate concern: use {@link createDurableObjectLockStore} with
 * `withLocks` from `@tanstack/ai-persistence` when you need multi-instance
 * coordination. Sandbox resume uses {@link createD1SandboxStore} + the same
 * shared lock token.
 */
export interface CloudflarePersistenceOptions {
  d1: D1Database
}

/**
 * Wire TanStack AI chat persistence over a migrated D1 binding.
 *
 * Returns {@link ChatPersistence} using the stock SQLite schema from
 * `@tanstack/ai-persistence-drizzle`. Prefer owning that schema in your app
 * and calling `drizzlePersistence` directly when you need renames or extra
 * columns. Durable Object locks are separate via
 * {@link createDurableObjectLockStore}. Sandbox resume is separate via
 * {@link createD1SandboxStore}.
 */
export function cloudflarePersistence(
  options: CloudflarePersistenceOptions,
): ChatPersistence {
  return {
    stores: createD1Stores(options.d1),
  }
}
