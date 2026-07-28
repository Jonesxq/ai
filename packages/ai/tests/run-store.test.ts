import { describe, expect, it } from 'vitest'
import { InMemoryRunStore, isTerminalRunStatus } from '../src/index'

describe('isTerminalRunStatus', () => {
  it('treats completed/failed/aborted as terminal and running/interrupted as not', () => {
    expect(isTerminalRunStatus('completed')).toBe(true)
    expect(isTerminalRunStatus('failed')).toBe(true)
    expect(isTerminalRunStatus('aborted')).toBe(true)
    expect(isTerminalRunStatus('running')).toBe(false)
    // `interrupted` is a human-in-the-loop pause, NOT a terminal state.
    expect(isTerminalRunStatus('interrupted')).toBe(false)
  })
})

describe('InMemoryRunStore', () => {
  it('createOrResume is idempotent and does not mutate an existing record', async () => {
    const store = new InMemoryRunStore()
    const first = await store.createOrResume({
      runId: 'r1',
      threadId: 't1',
      startedAt: 100,
    })
    expect(first.status).toBe('running')

    const second = await store.createOrResume({
      runId: 'r1',
      threadId: 't1',
      startedAt: 999,
      status: 'completed',
    })
    expect(second.startedAt).toBe(100)
    expect(second.status).toBe('running')
  })

  it('update patches mutable fields and no-ops for an unknown run', async () => {
    const store = new InMemoryRunStore()
    await store.createOrResume({ runId: 'r1', threadId: 't1', startedAt: 1 })
    await store.update('r1', { status: 'completed', finishedAt: 2 })
    const got = await store.get('r1')
    expect(got?.status).toBe('completed')
    expect(got?.finishedAt).toBe(2)

    await expect(
      store.update('nope', { status: 'failed' }),
    ).resolves.toBeUndefined()
    expect(await store.get('nope')).toBeNull()
  })

  it('lists runs by thread in start order', async () => {
    const store = new InMemoryRunStore()
    await store.createOrResume({ runId: 'a', threadId: 't1', startedAt: 2 })
    await store.createOrResume({ runId: 'b', threadId: 't1', startedAt: 1 })
    await store.createOrResume({ runId: 'c', threadId: 't2', startedAt: 3 })
    const listed = await store.listByThread('t1')
    expect(listed.map((r) => r.runId)).toEqual(['b', 'a'])
  })

  it('lists reclaimable runs: running, detached, past the ttl', async () => {
    const store = new InMemoryRunStore()
    await store.createOrResume({ runId: 'stale', threadId: 't1', startedAt: 1 })
    await store.update('stale', { detachedSince: 1_000 })
    await store.createOrResume({ runId: 'fresh', threadId: 't1', startedAt: 1 })
    await store.update('fresh', { detachedSince: 9_000 })
    await store.createOrResume({
      runId: 'attached',
      threadId: 't1',
      startedAt: 1,
    })

    const reclaimable = await store.listReclaimable({
      now: 10_000,
      ttlMs: 5_000,
    })
    expect(reclaimable.map((r) => r.runId)).toEqual(['stale'])
  })

  it('findActiveRun returns the newest running run for the thread only', async () => {
    const store = new InMemoryRunStore()
    await store.createOrResume({ runId: 'old', threadId: 't1', startedAt: 1 })
    await store.createOrResume({ runId: 'new', threadId: 't1', startedAt: 5 })
    await store.createOrResume({ runId: 'other', threadId: 't2', startedAt: 9 })

    // Highest `startedAt` among the thread's running runs wins — and a run on a
    // different thread never leaks in, even when it started later.
    expect((await store.findActiveRun('t1'))?.runId).toBe('new')
    expect((await store.findActiveRun('t2'))?.runId).toBe('other')

    // No running run for the thread → null (terminal and unknown threads alike).
    await store.update('old', { status: 'completed' })
    await store.update('new', { status: 'aborted' })
    expect(await store.findActiveRun('t1')).toBeNull()
    expect(await store.findActiveRun('nope')).toBeNull()
  })
})
