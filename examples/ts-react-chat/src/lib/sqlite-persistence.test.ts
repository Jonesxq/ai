/**
 * Proves the in-example `node:sqlite` backend satisfies the full
 * `AIPersistence` contract by running the shared conformance testkit from
 * `@tanstack/ai-persistence`. This is exactly how you would verify your own
 * hand-rolled adapter: point the testkit at your factory and keep it green.
 */
import { runPersistenceConformance } from '@tanstack/ai-persistence/testkit'
import { sqlitePersistence } from './sqlite-persistence'

// All four state stores are provided, so no STORE is skipped. Two OPTIONAL
// `runs` methods are genuinely missing here, and the suite requires each such
// omission to be declared: `listByThread` (this example never renders a
// thread's past runs) and `listReclaimable` (it has no reaper). Declaring them
// is what makes vitest report those two cases as SKIPPED; leaving them
// undeclared fails the suite, so a missing method can never read as a pass.
// `findActiveRun` IS implemented, so it stays under test.
//
// (Locks are not a state store and the suite does not cover them: this backend
// has no distributed lock primitive, which is a separate `withLocks` concern.)
runPersistenceConformance(
  'ts-react-chat example (node:sqlite)',
  () => sqlitePersistence({ url: ':memory:', migrate: true }),
  { skipMethods: ['runs.listByThread', 'runs.listReclaimable'] },
)
