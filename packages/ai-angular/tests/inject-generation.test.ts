import { Component } from '@angular/core'
import { getTestBed, TestBed } from '@angular/core/testing'
import {
  BrowserDynamicTestingModule,
  platformBrowserDynamicTesting,
} from '@angular/platform-browser-dynamic/testing'
import { describe, expect, it, vi } from 'vitest'
import { injectGeneration } from '../src/inject-generation'
import { injectGenerateVideo } from '../src/inject-generate-video'
import type { StreamChunk } from '@tanstack/ai'
import type {
  ConnectConnectionAdapter,
  GenerationPersistence,
  GenerationResumeSnapshot,
  RunAgentInputContext,
} from '@tanstack/ai-client'

// Ensure TestBed is initialized in this module's scope, regardless of whether
// the setup file's initialization was in a different module context (possible
// when the Angular plugin creates separate ESM module instances for compiled
// and setup files in Vitest).
const testBedInstance = getTestBed() as any
if (
  testBedInstance._compiler === null ||
  testBedInstance._compiler === undefined
) {
  getTestBed().initTestEnvironment(
    BrowserDynamicTestingModule,
    platformBrowserDynamicTesting(),
  )
}

function renderInjectGeneration(options: any) {
  @Component({ standalone: true, template: '' })
  class Host {
    gen = injectGeneration(options)
  }
  const fixture = TestBed.createComponent(Host)
  fixture.detectChanges()
  return {
    get result() {
      return fixture.componentInstance.gen
    },
    flush: () => fixture.detectChanges(),
    destroy: () => fixture.destroy(),
  }
}

function renderInjectGenerateVideo(options: any) {
  @Component({ standalone: true, template: '' })
  class Host {
    gen = injectGenerateVideo(options)
  }
  const fixture = TestBed.createComponent(Host)
  fixture.detectChanges()
  return {
    get result() {
      return fixture.componentInstance.gen
    },
    flush: () => fixture.detectChanges(),
    destroy: () => fixture.destroy(),
  }
}

const videoResumeSnapshot: GenerationResumeSnapshot = {
  resumeState: {
    threadId: 'thread-resume',
    runId: 'run-resume',
  },
  status: 'running',
}

/**
 * Storage adapter backed by a Map, so a test can seed a persisted record and
 * then assert on what the client read, wrote, and removed.
 */
function createMapPersistence(seed?: Record<string, GenerationResumeSnapshot>): {
  persistence: GenerationPersistence
  store: Map<string, GenerationResumeSnapshot>
  getItem: ReturnType<typeof vi.fn>
  setItem: ReturnType<typeof vi.fn>
  removeItem: ReturnType<typeof vi.fn>
} {
  const store = new Map<string, GenerationResumeSnapshot>(
    Object.entries(seed ?? {}),
  )
  const getItem = vi.fn((key: string) => store.get(key) ?? null)
  const setItem = vi.fn((key: string, value: GenerationResumeSnapshot) => {
    store.set(key, value)
  })
  const removeItem = vi.fn((key: string) => {
    store.delete(key)
  })
  return {
    persistence: { getItem, setItem, removeItem },
    store,
    getItem,
    setItem,
    removeItem,
  }
}

// Hydration and snapshot removal both run through awaited promise chains, so
// drain the microtask queue rather than awaiting a single tick.
async function flushPromises(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve()
  }
}

function createRunContextCaptureAdapter(chunks: Array<StreamChunk>): {
  adapter: ConnectConnectionAdapter
  connect: ReturnType<typeof vi.fn>
  runContexts: Array<RunAgentInputContext | undefined>
} {
  const runContexts: Array<RunAgentInputContext | undefined> = []
  const connect = vi.fn()
  const adapter: ConnectConnectionAdapter = {
    async *connect(_messages, _data, _signal, runContext) {
      connect(runContext)
      runContexts.push(runContext)
      for (const chunk of chunks) {
        yield chunk
      }
    },
  }
  return { adapter, connect, runContexts }
}

describe('injectGeneration', () => {
  it('initializes idle with a fetcher and generates a result', async () => {
    const fetcher = vi.fn(async () => ({ value: 42 }))
    const { result, flush } = renderInjectGeneration({ fetcher })

    expect(result.status()).toBe('idle')
    expect(result.result()).toBeNull()

    await result.generate({ prompt: 'x' })
    flush()
    expect(result.result()).toEqual({ value: 42 })
    expect(fetcher).toHaveBeenCalled()
  })

  it('throws without connection or fetcher', () => {
    expect(() => renderInjectGeneration({})).toThrow()
  })

  it('transforms the result when onResult returns a value', async () => {
    const { result, flush } = renderInjectGeneration({
      fetcher: async () => ({ id: '1', audio: 'base64data' }),
      onResult: (raw: { id: string; audio: string }) => ({
        playable: raw.audio.length > 0,
      }),
    })

    await result.generate({ prompt: 'x' })
    flush()
    expect(result.result()).toEqual({ playable: true })
    expect(result.status()).toBe('success')
  })

  it('does not auto-fire a generation after render from a persisted running snapshot', async () => {
    // Regression guard for the removed generation resume surface.
    const snapshot: GenerationResumeSnapshot = {
      resumeState: { threadId: 'thread-resume', runId: 'run-resume' },
      status: 'running',
    }
    const { adapter, connect } = createRunContextCaptureAdapter([])
    const getItem = vi.fn(() => snapshot)
    const { result } = renderInjectGeneration({
      id: 'no-auto-fire',
      connection: adapter,
      persistence: { getItem, setItem: vi.fn(), removeItem: vi.fn() },
      initialResumeSnapshot: snapshot,
    })

    await Promise.resolve()

    expect(connect).not.toHaveBeenCalled()
    expect(getItem).not.toHaveBeenCalled()
    expect(result.isLoading()).toBe(false)
    expect(result.status()).toBe('idle')
    // The persisted snapshot remains exposed as read-only state.
    expect(result.resumeState()).toEqual(snapshot.resumeState)
  })

  it('hydrates a persisted snapshot from storage on construction', async () => {
    const { adapter, connect } = createRunContextCaptureAdapter([])
    const { persistence, getItem } = createMapPersistence({
      'generation:hydrate-me': {
        resumeState: { threadId: 'thread-stored', runId: 'run-stored' },
        status: 'running',
      },
    })
    const { result } = renderInjectGeneration({
      id: 'hydrate-me',
      connection: adapter,
      persistence,
    })

    await flushPromises()

    expect(getItem).toHaveBeenCalledTimes(1)
    expect(getItem).toHaveBeenCalledWith('generation:hydrate-me')
    // Hydration only surfaces state; it never restarts the run.
    expect(connect).not.toHaveBeenCalled()
    expect(result.resumeSnapshot()).toEqual({
      schemaVersion: 1,
      resumeState: { threadId: 'thread-stored', runId: 'run-stored' },
      status: 'running',
    })
    expect(result.resumeState()).toEqual({
      threadId: 'thread-stored',
      runId: 'run-stored',
    })
  })

  it('clears the snapshot and removes the persisted record on reset', async () => {
    const snapshot: GenerationResumeSnapshot = {
      resumeState: { threadId: 'thread-reset', runId: 'run-reset' },
      status: 'running',
    }
    const { adapter } = createRunContextCaptureAdapter([])
    const { persistence, removeItem, store } = createMapPersistence({
      'generation:reset-me': snapshot,
    })
    const { result } = renderInjectGeneration({
      id: 'reset-me',
      connection: adapter,
      persistence,
      initialResumeSnapshot: snapshot,
    })

    expect(result.resumeSnapshot()).toEqual(snapshot)

    result.reset()
    await flushPromises()

    expect(result.resumeSnapshot()).toBeUndefined()
    expect(result.resumeState()).toBeNull()
    expect(result.pendingArtifacts()).toEqual([])
    expect(result.resultArtifacts()).toEqual([])
    expect(removeItem).toHaveBeenCalledWith('generation:reset-me')
    expect(store.has('generation:reset-me')).toBe(false)
  })
})

describe('injectGenerateVideo', () => {
  it('does not auto-fire a video generation after render from a persisted running snapshot', async () => {
    // Regression guard for the removed generation resume surface (video).
    const { adapter, connect } = createRunContextCaptureAdapter([])
    const getItem = vi.fn(() => videoResumeSnapshot)
    const { result } = renderInjectGenerateVideo({
      id: 'video-no-auto-fire',
      connection: adapter,
      persistence: { getItem, setItem: vi.fn(), removeItem: vi.fn() },
      initialResumeSnapshot: videoResumeSnapshot,
    })

    await Promise.resolve()

    expect(connect).not.toHaveBeenCalled()
    expect(getItem).not.toHaveBeenCalled()
    expect(result.isLoading()).toBe(false)
    expect(result.status()).toBe('idle')
    // The persisted snapshot remains exposed as read-only state.
    expect(result.resumeSnapshot()).toEqual(videoResumeSnapshot)
    expect(result.resumeState()).toEqual(videoResumeSnapshot.resumeState)
  })

  it('hydrates from storage and clears the persisted record on reset', async () => {
    const { adapter, connect } = createRunContextCaptureAdapter([])
    const { persistence, getItem, removeItem, store } = createMapPersistence({
      'generation:video-hydrate': videoResumeSnapshot,
    })
    const { result } = renderInjectGenerateVideo({
      id: 'video-hydrate',
      connection: adapter,
      persistence,
    })

    await flushPromises()

    expect(getItem).toHaveBeenCalledTimes(1)
    expect(getItem).toHaveBeenCalledWith('generation:video-hydrate')
    expect(connect).not.toHaveBeenCalled()
    expect(result.resumeSnapshot()).toEqual({
      schemaVersion: 1,
      ...videoResumeSnapshot,
    })

    result.reset()
    await flushPromises()

    expect(result.resumeSnapshot()).toBeUndefined()
    expect(result.resumeState()).toBeNull()
    expect(removeItem).toHaveBeenCalledWith('generation:video-hydrate')
    expect(store.has('generation:video-hydrate')).toBe(false)
  })
})
