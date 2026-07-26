/**
 * Prisma-backed state persistence for TanStack AI.
 *
 * Add the provider-neutral {@link prismaModels} fragment to a Prisma multi-file
 * schema, run Prisma's normal migration workflow for your selected provider,
 * then pass the generated client to {@link prismaPersistence}.
 */
import { resolveDelegates } from './model-contract'
import {
  createInterruptStore,
  createMessageStore,
  createMetadataStore,
  createRunStore,
} from './stores'
import type { ChatPersistence } from '@tanstack/ai-persistence'
import type { PrismaModelMap } from './model-contract'

export { prismaModels, prismaModelsFilename } from './models'
export { PrismaModelError } from './model-contract'
export type { PrismaModelMap } from './model-contract'
export { createPrismaSandboxStore } from './sandbox-store'
export type { PrismaSandboxStoreOptions } from './sandbox-store'

/**
 * Structural stand-in for a generated Prisma client.
 *
 * We deliberately do **not** import `PrismaClient` from `@prisma/client`: the
 * stores only ever read model delegates off the client by name at runtime
 * (see `resolveDelegates`), and the delegate query API (`findUnique`, `upsert`,
 * `findMany`, `updateMany`, `deleteMany`) is identical across Prisma majors.
 * Typing the parameter structurally keeps this package compatible with both the
 * v6 `prisma-client-js` generator (client under `@prisma/client`) and the v7
 * `prisma-client` generator (client emitted to a custom `output` path and not
 * exported from `@prisma/client`), so v7 users pass their generated client
 * without a type mismatch.
 */
export type PrismaClientLike = object

export interface PrismaPersistenceOptions {
  /**
   * Rename the TanStack AI models in your copy of the fragment — for example
   * to avoid a collision with an existing `Message` or `Run` model — and map
   * each store to the renamed client delegate here. Values are the camelCase
   * client accessor names: `model ChatMessage` → `{ messages: 'chatMessage' }`.
   * Keep the field names and types from the fragment; database table and
   * column names are already yours via `@@map` / `@map`.
   */
  models?: PrismaModelMap
}

/**
 * Wire TanStack AI persistence stores over a migrated Prisma client.
 *
 * Returns {@link ChatPersistence} (messages + runs + interrupts + metadata).
 * Sandbox resume is separate via {@link createPrismaSandboxStore} so chat-only
 * clients need not include the `Sandbox` model.
 *
 * Locks are a separate concern. For multi-instance coordination use `withLocks`
 * with a distributed `LockStore`.
 */
export function prismaPersistence(
  prisma: PrismaClientLike,
  options?: PrismaPersistenceOptions,
): ChatPersistence {
  const delegates = resolveDelegates(prisma, options?.models)
  return {
    stores: {
      messages: createMessageStore(delegates),
      runs: createRunStore(delegates),
      interrupts: createInterruptStore(delegates),
      metadata: createMetadataStore(delegates),
    },
  }
}
