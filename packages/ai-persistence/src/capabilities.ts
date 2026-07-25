/**
 * Persistence capability tokens.
 *
 * `withPersistence` PROVIDES persistence/interrupts so later middleware can
 * read durable state. Locks are a separate concern: `withLocks` PROVIDES
 * `LocksCapability` (defined in `./locks`).
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

// Locks token lives in ./locks; re-export for a single import surface.
export { LocksCapability, getLocks, provideLocks } from './locks'
