import { createD1Stores } from './d1'
import type { ChatPersistence } from '@tanstack/ai-persistence'

export { createD1Stores } from './d1'
export {
  CloudflareLockDurableObject,
  createDurableObjectLockStore,
} from './locks'
export { d1Migrations } from './migrations'
export type { D1Migration } from './migrations'
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
 * Locks are a separate concern: use {@link createDurableObjectLockStore} with
 * `withLocks` from `@tanstack/ai-persistence` when you need multi-instance
 * coordination.
 */
export interface CloudflarePersistenceOptions {
  d1: D1Database
}

/**
 * Wire TanStack AI chat persistence over a migrated D1 binding.
 *
 * Returns {@link ChatPersistence}. Durable Object locks are separate via
 * {@link createDurableObjectLockStore}.
 */
export function cloudflarePersistence(
  options: CloudflarePersistenceOptions,
): ChatPersistence {
  return {
    stores: createD1Stores(options.d1),
  }
}
