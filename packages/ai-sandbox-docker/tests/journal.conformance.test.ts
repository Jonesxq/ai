import Dockerode from 'dockerode'
import { runJournalConformance } from '@tanstack/ai-sandbox/testkit'
import { dockerSandbox } from '../src/index'

// Auto-gate: only run when a Docker daemon is reachable, mirroring
// docker.test.ts's `dockerAvailable` gate. A missing daemon is not the
// provider being incapable of journaling — it is this environment lacking a
// daemon — so the case renders as a `unsupported` skip with the reason,
// never a silent pass or a hard failure.
let dockerAvailable = false
try {
  await new Dockerode().ping()
  dockerAvailable = true
} catch {
  // no daemon — the suite below declares `unsupported` and skips.
}

const IMAGE = 'alpine:3'

runJournalConformance({
  name: 'docker',
  createHandle: async () => {
    const provider = dockerSandbox({ image: IMAGE })
    const handle = await provider.create({})
    return { handle, dispose: () => handle.destroy() }
  },
  ...(dockerAvailable
    ? {}
    : { unsupported: { reason: 'no Docker daemon reachable' } }),
})
