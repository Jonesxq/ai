// Store contracts + named chat shapes
export { composePersistence, defineAIPersistence } from './types'
export type {
  MessageStore,
  RunStatus,
  RunRecord,
  RunStore,
  InterruptRecord,
  InterruptStatus,
  InterruptStore,
  MetadataStore,
  // Named product shapes (prefer these over a sparse bag)
  ChatTranscriptStores,
  ChatPersistenceStores,
  ChatWithInterruptsStores,
  ChatTranscriptPersistence,
  ChatPersistence,
  ChatWithInterruptsPersistence,
  AIPersistence,
  AIPersistenceOverrides,
  ComposedAIPersistenceStores,
  // Shared conversation identity from @tanstack/ai. Stores key on
  // Scope.threadId; authorize multi-user access with Scope.userId/tenantId.
  Scope,
} from './types'
// AIPersistenceStores is intentionally NOT re-exported — use a named chat
// shape or AIPersistence<{ messages: MessageStore, … }>.

// Middleware (state + separate locks)
export {
  withPersistence,
  withGenerationPersistence,
  withLocks,
} from './middleware'

// Server helper: rehydrate a thread's messages for a client load
export { reconstructChat } from './reconstruct'
export type { ReconstructChatOptions } from './reconstruct'

// Reference in-memory implementation (state stores only)
export { memoryPersistence } from './memory'

// Interrupt controller
export { createInterruptController } from './interrupts'
export type { InterruptController } from './interrupts'

// Capabilities
export {
  PersistenceCapability,
  InterruptsCapability,
  getPersistence,
  providePersistence,
  getInterrupts,
  provideInterrupts,
  LocksCapability,
  getLocks,
  provideLocks,
} from './capabilities'

// Lock primitive (separate from state stores; provide via withLocks)
export { InMemoryLockStore } from './locks'
export type { LockStore } from './locks'
