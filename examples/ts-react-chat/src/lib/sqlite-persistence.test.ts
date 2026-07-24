/**
 * Proves the in-example `node:sqlite` backend satisfies the full
 * `AIPersistence` contract by running the shared conformance testkit from
 * `@tanstack/ai-persistence`. This is exactly how you would verify your own
 * hand-rolled adapter: point the testkit at your factory and keep it green.
 */
import { runPersistenceConformance } from '@tanstack/ai-persistence/testkit'
import { sqlitePersistence } from './sqlite-persistence'

runPersistenceConformance(
  'ts-react-chat example (node:sqlite)',
  () => sqlitePersistence({ url: ':memory:', migrate: true }),
  // This backend has no distributed lock primitive.
  { skip: ['locks'] },
)
