import { runSandboxStoreConformance } from '@tanstack/ai-sandbox/testkit'
import { createDrizzleSandboxStore, defaultSqliteSandboxes } from '../src/index'
import { sqlitePersistence } from '../src/sqlite'

// A fresh in-memory database per store keeps each conformance case isolated.
runSandboxStoreConformance('drizzle-sqlite', () => {
  const persistence = sqlitePersistence({ url: ':memory:' })
  return createDrizzleSandboxStore(persistence.db, defaultSqliteSandboxes)
})
