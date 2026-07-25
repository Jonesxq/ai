/// <reference types="@cloudflare/workers-types" />
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Miniflare } from 'miniflare'
import {
  createDefaultSqliteSchema,
  ensureSqliteTables,
} from '@tanstack/ai-persistence-drizzle'
import { runPersistenceConformance } from '@tanstack/ai-persistence/testkit'
import { cloudflarePersistence } from '../src/index'
import { composePersistence } from '@tanstack/ai-persistence'
import type { ChatPersistence, InterruptStore } from '@tanstack/ai-persistence'

interface RuntimeBindings {
  AI_DB: D1Database
}

/**
 * Bootstrap stock tables on a Miniflare D1 binding the same way production
 * apps do: derive DDL from the Drizzle SQLite schema SoT (not package-owned
 * migration SQL).
 */
async function ensureDefaultTables(d1: D1Database): Promise<void> {
  const schema = createDefaultSqliteSchema()
  const statements: Array<string> = []
  ensureSqliteTables((sql) => {
    statements.push(sql)
  }, schema)
  await d1.batch(statements.map((statement) => d1.prepare(statement)))
}

describe('Cloudflare persistence on Miniflare bindings', () => {
  let miniflare: Miniflare
  let persistence: ChatPersistence

  beforeAll(async () => {
    miniflare = new Miniflare({
      compatibilityDate: '2026-06-24',
      d1Databases: ['AI_DB'],
      modules: true,
      script: 'export default { fetch() { return new Response("ok") } }',
    })
    const bindings = await miniflare.getBindings<RuntimeBindings>()
    await ensureDefaultTables(bindings.AI_DB)
    persistence = cloudflarePersistence({
      d1: bindings.AI_DB,
    })
  })

  afterAll(async () => {
    await miniflare.dispose()
  })

  runPersistenceConformance('cloudflare-d1', () => persistence)

  it('composes a custom interrupt store while retaining D1 runs', () => {
    const customInterrupts: InterruptStore = {
      create: () => Promise.resolve(),
      resolve: () => Promise.resolve(),
      cancel: () => Promise.resolve(),
      get: () => Promise.resolve(null),
      list: () => Promise.resolve([]),
      listPending: () => Promise.resolve([]),
      listByRun: () => Promise.resolve([]),
      listPendingByRun: () => Promise.resolve([]),
    }
    const composed = composePersistence(persistence, {
      overrides: { interrupts: customInterrupts },
    })

    expect(composed.stores.interrupts).toBe(customInterrupts)
    expect(composed.stores.runs).toBe(persistence.stores.runs)
  })

  it('removes only stores explicitly disabled by an override', () => {
    const composed = composePersistence(persistence, {
      overrides: { interrupts: false },
    })

    expect('interrupts' in composed.stores).toBe(false)
    expect(composed.stores.runs).toBe(persistence.stores.runs)
    expect(composed.stores.messages).toBe(persistence.stores.messages)
  })
})
