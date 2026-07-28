import { expectTypeOf } from 'vitest'
import type { StreamDurability, UpsertableStreamDurability } from '@tanstack/ai'
import type { DurableStreamOffset, durableStream } from '../src'

declare const durability: ReturnType<typeof durableStream>
declare const offset: DurableStreamOffset

expectTypeOf(
  durability.resumeFrom(),
).toEqualTypeOf<DurableStreamOffset | null>()
durability.read(offset)
durability.read('-1')
durability.read('now')

// @ts-expect-error arbitrary strings are not validated adapter cursors
durability.read('unvalidated-offset')

// durableStream's offsets are backend-assigned, so it returns a plain
// StreamDurability and must be assignable to it.
const asStreamDurability: StreamDurability<DurableStreamOffset> = durability
void asStreamDurability

// It must NOT be assignable to UpsertableStreamDurability: a caller cannot
// choose durableStream's offsets, so there is no upsert to expose. If this
// ever starts compiling, the capability distinction has been silently lost.
// @ts-expect-error durableStream does not implement upsert (offsets are backend-assigned)
const asUpsertable: UpsertableStreamDurability<DurableStreamOffset> = durability
void asUpsertable
