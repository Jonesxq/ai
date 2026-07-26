/// <reference types="@cloudflare/workers-types" />
import { afterAll, beforeAll } from 'vitest'
import { Miniflare } from 'miniflare'
import { runSandboxStoreConformance } from '@tanstack/ai-sandbox/testkit'
import { createD1SandboxStore } from '../src/index'

interface RuntimeBindings {
  AI_DB: D1Database
}

let miniflare: Miniflare
let db: D1Database

const SANDBOXES_DDL =
  'CREATE TABLE IF NOT EXISTS sandboxes (key TEXT PRIMARY KEY NOT NULL, provider TEXT NOT NULL, provider_sandbox_id TEXT NOT NULL, latest_snapshot_id TEXT, thread_id TEXT NOT NULL, latest_run_id TEXT, updated_at INTEGER NOT NULL)'

beforeAll(async () => {
  miniflare = new Miniflare({
    compatibilityDate: '2026-06-24',
    d1Databases: ['AI_DB'],
    modules: true,
    script: 'export default { fetch() { return new Response("ok") } }',
  })
  const bindings = await miniflare.getBindings<RuntimeBindings>()
  db = bindings.AI_DB
  await db.prepare(SANDBOXES_DDL).run()
})

afterAll(async () => {
  await miniflare.dispose()
})

// One D1 binding is shared; truncating the table per store keeps each
// conformance case isolated.
runSandboxStoreConformance('cloudflare-d1', async () => {
  await db.prepare('DELETE FROM sandboxes').run()
  return createD1SandboxStore(db)
})
