/**
 * The `'locks'` capability lives in core `@tanstack/ai` (its neutral home) so
 * the durable lock this package provides via {@link withLocks} reaches
 * `@tanstack/ai-sandbox`'s `ensure` through the SAME token reference. This
 * module re-exports it unchanged so persistence consumers keep importing
 * everything lock-related from `@tanstack/ai-persistence`.
 *
 * Locks are **not** part of {@link AIPersistenceStores}. State persistence
 * (messages/runs/interrupts/metadata/sandbox) and mutual exclusion are separate
 * concerns: wire locks with {@link withLocks}, not via `composePersistence`.
 */
export {
  LocksCapability,
  getLocks,
  provideLocks,
  InMemoryLockStore,
} from '@tanstack/ai'
export type { LockStore } from '@tanstack/ai'
