import { expectTypeOf } from 'vitest'
import type { DrizzleD1Database } from 'drizzle-orm/d1'
import type { PgliteDatabase } from 'drizzle-orm/pglite'
import type {
  ChatAndSandboxPersistence,
  ChatPersistence,
  MessageStore,
  RunStore,
} from '@tanstack/ai-persistence'
import {
  createDefaultPgSchema,
  createDefaultSqliteSchema,
  drizzlePersistence,
} from '../src/index'
import { sqlitePersistence } from '../src/sqlite'
import { schema as emittedSchema } from '../src/sqlite/assets/tanstack-ai-schema'
import { schema as emittedPgSchema } from '../src/pg/assets/tanstack-ai-schema'
import { variantSchema } from './variant-schema'
import type { TanstackAiPgSchema, TanstackAiSqliteSchema } from '../src/index'

declare const d1Database: DrizzleD1Database
declare const pgDatabase: PgliteDatabase
const defaultSchema = createDefaultSqliteSchema()
const defaultPgSchema = createDefaultPgSchema()
const d1Persistence = drizzlePersistence(d1Database, {
  provider: 'sqlite',
  schema: defaultSchema,
})
expectTypeOf(d1Persistence).toEqualTypeOf<ChatPersistence>()
expectTypeOf(d1Persistence.stores.messages).toEqualTypeOf<MessageStore>()
expectTypeOf(d1Persistence.stores.runs).toEqualTypeOf<RunStore>()
// State bag only — locks are provided separately via withLocks.
expectTypeOf(d1Persistence.stores).not.toHaveProperty('locks')

const pgPersistence = drizzlePersistence(pgDatabase, {
  provider: 'pg',
  schema: defaultPgSchema,
})
expectTypeOf(pgPersistence).toEqualTypeOf<ChatPersistence>()

// Provider, db, and schema dialects must agree.
// @ts-expect-error sqlite db cannot be used with provider 'pg'
drizzlePersistence(d1Database, { provider: 'pg', schema: defaultPgSchema })
// @ts-expect-error pg db cannot be used with provider 'sqlite'
drizzlePersistence(pgDatabase, { provider: 'sqlite', schema: defaultSchema })
// @ts-expect-error pg schema cannot be used with provider 'sqlite'
drizzlePersistence(d1Database, { provider: 'sqlite', schema: defaultPgSchema })
// @ts-expect-error sqlite schema cannot be used with provider 'pg'
drizzlePersistence(pgDatabase, { provider: 'pg', schema: defaultSchema })
// @ts-expect-error provider is required
drizzlePersistence(d1Database, { schema: defaultSchema })

const sqlite = sqlitePersistence({ url: ':memory:' })
expectTypeOf(sqlite.stores).toEqualTypeOf<ChatAndSandboxPersistence['stores']>()
expectTypeOf(sqlite.close).toEqualTypeOf<() => void>()

// Default factories, emitted assets, and renamed/extended variant all satisfy
// the injectable schema contracts.
expectTypeOf(defaultSchema).toExtend<TanstackAiSqliteSchema>()
expectTypeOf(emittedSchema).toExtend<TanstackAiSqliteSchema>()
expectTypeOf(variantSchema).toExtend<TanstackAiSqliteSchema>()
expectTypeOf(defaultPgSchema).toExtend<TanstackAiPgSchema>()
expectTypeOf(emittedPgSchema).toExtend<TanstackAiPgSchema>()

const customPersistence = drizzlePersistence(d1Database, {
  provider: 'sqlite',
  schema: variantSchema,
})
expectTypeOf(customPersistence).toEqualTypeOf<ChatPersistence>()
