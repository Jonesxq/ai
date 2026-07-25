/// <reference types="@cloudflare/workers-types" />
import { expectTypeOf } from 'vitest'
import { composePersistence } from '@tanstack/ai-persistence'
import {
  CloudflareLockDurableObject,
  cloudflarePersistence,
  createDurableObjectLockStore,
} from '../src/index'
import type {
  ChatPersistence,
  InterruptStore,
  LockStore,
  MessageStore,
  MetadataStore,
  RunStore,
} from '@tanstack/ai-persistence'

declare const d1: D1Database
declare const durableObjects: DurableObjectNamespace
declare const durableObjectState: DurableObjectState

new CloudflareLockDurableObject(durableObjectState)

expectTypeOf(cloudflarePersistence({ d1 })).toEqualTypeOf<ChatPersistence>()
expectTypeOf(cloudflarePersistence({ d1 }).stores).toMatchTypeOf<{
  messages: MessageStore
  runs: RunStore
  interrupts?: InterruptStore
  metadata?: MetadataStore
}>()
// Packaged backends always provide all four state stores:
expectTypeOf(cloudflarePersistence({ d1 }).stores.messages).toEqualTypeOf<MessageStore>()
expectTypeOf(cloudflarePersistence({ d1 }).stores.runs).toEqualTypeOf<RunStore>()

// Locks are a separate export — not part of the state bag.
expectTypeOf(
  createDurableObjectLockStore(durableObjects),
).toEqualTypeOf<LockStore>()

const d1Persistence = cloudflarePersistence({ d1 })
declare const customInterrupts: InterruptStore
const replaced = composePersistence(d1Persistence, {
  overrides: { interrupts: customInterrupts },
})
expectTypeOf(replaced.stores.interrupts).toEqualTypeOf<InterruptStore>()
expectTypeOf(replaced.stores.runs).toEqualTypeOf<RunStore>()

const removed = composePersistence(d1Persistence, {
  overrides: { interrupts: false },
})
expectTypeOf(removed.stores.messages).toEqualTypeOf<MessageStore>()
expectTypeOf(removed.stores.runs).toEqualTypeOf<RunStore>()
// @ts-expect-error interrupts removed
removed.stores.interrupts
