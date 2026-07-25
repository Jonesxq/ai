import { expectTypeOf } from 'vitest'
import { PrismaClient } from '@prisma/client'
import type { ChatPersistence, MessageStore, RunStore } from '@tanstack/ai-persistence'
import { prismaPersistence } from '../src/index'
import type {
  InterruptDelegate,
  MessageDelegate,
  MetadataDelegate,
  RunDelegate,
} from '../src/model-contract'

declare const prisma: PrismaClient
const persistence = prismaPersistence(prisma)

// The generated client's delegates must satisfy the structural delegate
// contract the stores are written against — this is what makes renamed
// delegates from a user-generated client interchangeable with canonical ones.
expectTypeOf(prisma.message).toExtend<MessageDelegate>()
expectTypeOf(prisma.run).toExtend<RunDelegate>()
expectTypeOf(prisma.interrupt).toExtend<InterruptDelegate>()
expectTypeOf(prisma.metadata).toExtend<MetadataDelegate>()

const mapped = prismaPersistence(prisma, {
  models: { messages: 'chatMessage' },
})
expectTypeOf(mapped).toEqualTypeOf<ChatPersistence>()

expectTypeOf(persistence).toEqualTypeOf<ChatPersistence>()
expectTypeOf(persistence.stores.messages).toEqualTypeOf<MessageStore>()
expectTypeOf(persistence.stores.runs).toEqualTypeOf<RunStore>()
// State bag only — locks are provided separately via withLocks.
expectTypeOf(persistence.stores).not.toHaveProperty('locks')
