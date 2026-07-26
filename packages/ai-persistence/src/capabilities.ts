/**
 * Persistence capability tokens.
 *
 * `withPersistence` PROVIDES persistence/interrupts (and optionally the shared
 * `sandbox-store` token) so later middleware can read durable state. Locks are a
 * separate concern: `withLocks` PROVIDES `LocksCapability` (re-exported from
 * core via `./locks`).
 */
import { createCapability } from '@tanstack/ai'
import type { AIPersistence, InterruptStore } from './types'

export const PersistenceCapability =
  createCapability<AIPersistence>()('persistence')

export const InterruptsCapability = createCapability<InterruptStore>()(
  'persistence.interrupts',
)

export const [getPersistence, providePersistence] = PersistenceCapability
export const [getInterrupts, provideInterrupts] = InterruptsCapability

// Shared tokens from core (locks via ./locks so the re-export path is local).
export { LocksCapability, getLocks, provideLocks } from './locks'
export {
  SandboxStoreCapability,
  getSandboxStore,
  provideSandboxStore,
} from '@tanstack/ai'
