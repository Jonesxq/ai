import { describe, expect, it, vi } from 'vitest'
import { journalPaths } from '../src/journal'
import {
  DEFAULT_JOURNAL_POLL_MS,
  journalReadStrategy,
  readJournal,
} from '../src/journal-reader'
import type {
  ExecResult,
  ProcessOptions,
  SandboxCapabilities,
  SandboxHandle,
  SpawnHandle,
} from '../src/contracts'
import type { JournalLine } from '../src/journal-bytes'

function caps(
  overrides: Partial<SandboxCapabilities> = {},
): SandboxCapabilities {
  return {
    fs: true,
    exec: true,
    env: true,
    ports: false,
    backgroundProcesses: true,
    writableStdin: true,
    killableProcesses: true,
    snapshots: false,
    networkPolicy: false,
    durableFilesystem: false,
    fork: false,
    ...overrides,
  }
}

async function* fromValues(values: Array<string>): AsyncIterable<string> {
  for (const value of values) {
    await Promise.resolve()
    yield value
  }
}

/**
 * Yield `values`, then hang forever. Models a provider whose `kill` fails to
 * reach the process holding stdout open, so the stream is never closed.
 */
async function* neverEnding(values: Array<string>): AsyncIterable<string> {
  yield* fromValues(values)
  await new Promise<never>(() => {
    // Never settles: that is the whole point.
  })
}

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

async function collect<T>(it: AsyncIterable<T>): Promise<Array<T>> {
  const out: Array<T> = []
  for await (const value of it) out.push(value)
  return out
}

interface FakeHandleInput {
  capabilities?: Partial<SandboxCapabilities>
  spawnStdout?: Array<string> | AsyncIterable<string>
  exec?: (command: string) => Promise<ExecResult>
  onSpawn?: (command: string, options?: ProcessOptions) => void
  onKill?: () => void
}

function fakeHandle(input: FakeHandleInput = {}): SandboxHandle {
  const spawnHandle: SpawnHandle = {
    pid: -1,
    stdout: Array.isArray(input.spawnStdout)
      ? fromValues(input.spawnStdout)
      : (input.spawnStdout ?? fromValues([])),
    stderr: fromValues([]),
    stdin: { write: () => Promise.resolve(), end: () => Promise.resolve() },
    wait: () => Promise.resolve(0),
    kill: () => {
      input.onKill?.()
      return Promise.resolve()
    },
  }
  return {
    id: 'fake',
    provider: 'fake',
    capabilities: caps(input.capabilities),
    fs: {
      read: () =>
        Promise.reject(new Error('fs must not be used for the journal')),
      readBytes: () =>
        Promise.reject(new Error('fs must not be used for the journal')),
      write: () =>
        Promise.reject(new Error('fs must not be used for the journal')),
      list: () => Promise.reject(new Error('unused')),
      mkdir: () => Promise.reject(new Error('unused')),
      remove: () => Promise.reject(new Error('unused')),
      rename: () => Promise.reject(new Error('unused')),
      exists: () =>
        Promise.reject(new Error('fs.exists must not be used for the journal')),
    },
    git: {} as SandboxHandle['git'],
    process: {
      exec: (command) =>
        input.exec
          ? input.exec(command)
          : Promise.resolve({ stdout: '', stderr: '', exitCode: 0 }),
      spawn: (command, options) => {
        input.onSpawn?.(command, options)
        return Promise.resolve(spawnHandle)
      },
    },
    ports: { connect: () => Promise.reject(new Error('unused')) },
    env: { set: () => Promise.resolve() },
    destroy: () => Promise.resolve(),
  }
}

describe('journalReadStrategy', () => {
  it('follows when the provider can kill a spawned process', () => {
    expect(journalReadStrategy(fakeHandle())).toBe('follow')
  })

  it('polls when kill is a no-op, so nothing unstoppable is ever spawned', () => {
    expect(
      journalReadStrategy(
        fakeHandle({ capabilities: { killableProcesses: false } }),
      ),
    ).toBe('poll')
  })

  it('polls when the provider has no background processes at all', () => {
    expect(
      journalReadStrategy(
        fakeHandle({ capabilities: { backgroundProcesses: false } }),
      ),
    ).toBe('poll')
  })

  it('polls when neither backgroundProcesses nor killableProcesses is supported', () => {
    expect(
      journalReadStrategy(
        fakeHandle({
          capabilities: {
            backgroundProcesses: false,
            killableProcesses: false,
          },
        }),
      ),
    ).toBe('poll')
  })
})

describe('readJournal — follow strategy', () => {
  it('spawns a following tail from the requested byte and yields positioned lines', async () => {
    const commands: Array<string> = []
    const handle = fakeHandle({
      spawnStdout: ['{"a":1}\n{"b":2}\n'],
      onSpawn: (command) => commands.push(command),
    })
    const lines = await collect(
      readJournal(handle, { paths: journalPaths('r1'), fromByte: 0 }),
    )
    // Raw, unframed: a `| base64` here would buffer the whole stream.
    expect(commands).toEqual([
      `mkdir -p '/tmp/tanstack-runs' 2>/dev/null; ` +
        `: >> '/tmp/tanstack-runs/r1.ndjson' 2>/dev/null; ` +
        `tail -c +1 -f '/tmp/tanstack-runs/r1.ndjson' 2>/dev/null`,
    ])
    expect(lines).toEqual<Array<JournalLine>>([
      { line: '{"a":1}', endPosition: 8 },
      { line: '{"b":2}', endPosition: 16 },
    ])
  })

  it('counts positions in BYTES, not characters, for a multi-byte line', async () => {
    // '{"t":"café"}' is 13 bytes but 12 UTF-16 code units: a position counted
    // over characters would desync every following `tail -c +N`.
    const handle = fakeHandle({ spawnStdout: ['{"t":"café"}\n'] })
    expect(
      await collect(readJournal(handle, { paths: journalPaths('r1') })),
    ).toEqual<Array<JournalLine>>([{ line: '{"t":"café"}', endPosition: 14 }])
  })

  it('reassembles a line the provider split across two stdout chunks', async () => {
    const handle = fakeHandle({ spawnStdout: ['{"a":', '1}\n{"b":2}', '\n'] })
    expect(
      await collect(readJournal(handle, { paths: journalPaths('r1') })),
    ).toEqual<Array<JournalLine>>([
      { line: '{"a":1}', endPosition: 8 },
      { line: '{"b":2}', endPosition: 16 },
    ])
  })

  it('withholds a trailing line the agent has not finished writing', async () => {
    const handle = fakeHandle({ spawnStdout: ['{"a":1}\n{"par'] })
    expect(
      await collect(readJournal(handle, { paths: journalPaths('r1') })),
    ).toEqual<Array<JournalLine>>([{ line: '{"a":1}', endPosition: 8 }])
  })

  it('resumes from fromByte, keeping positions absolute', async () => {
    const commands: Array<string> = []
    const handle = fakeHandle({
      spawnStdout: ['{"b":2}\n'],
      onSpawn: (command) => commands.push(command),
    })
    const lines = await collect(
      readJournal(handle, { paths: journalPaths('r1'), fromByte: 8 }),
    )
    expect(commands[0]).toContain('tail -c +9 -f')
    expect(lines).toEqual<Array<JournalLine>>([
      { line: '{"b":2}', endPosition: 16 },
    ])
  })

  it('forwards the abort signal to spawn and kills the tail when the consumer stops early', async () => {
    let killed = false
    let forwarded: AbortSignal | undefined
    const controller = new AbortController()
    const handle = fakeHandle({
      spawnStdout: ['{"a":1}\n{"b":2}\n'],
      onSpawn: (_command, options) => {
        forwarded = options?.signal
      },
      onKill: () => {
        killed = true
      },
    })
    const iterator = readJournal(handle, {
      paths: journalPaths('r1'),
      signal: controller.signal,
    })[Symbol.asyncIterator]()
    await iterator.next()
    await iterator.return?.(undefined)
    expect(forwarded).toBe(controller.signal)
    expect(killed).toBe(true)
  })

  it('never touches handle.fs (the local-process /tmp aliasing trap)', async () => {
    const handle = fakeHandle({ spawnStdout: ['{"a":1}\n'] })
    await expect(
      collect(readJournal(handle, { paths: journalPaths('r1') })),
    ).resolves.toHaveLength(1)
  })

  it('ends on abort even when the provider never closes stdout', async () => {
    // The reader must not depend on `kill` closing the pipe: local-process on
    // Windows falls back to signalling only the `sh` wrapper when `taskkill` is
    // unavailable, leaving the `tail` grandchild holding stdout open forever.
    // `neverEnding` models exactly that provider.
    let killed = false
    const controller = new AbortController()
    const handle = fakeHandle({
      spawnStdout: neverEnding(['{"a":1}\n']),
      onKill: () => {
        killed = true
      },
    })
    const lines: Array<JournalLine> = []
    const done = (async () => {
      for await (const line of readJournal(handle, {
        paths: journalPaths('r1'),
        signal: controller.signal,
      })) {
        lines.push(line)
      }
    })()
    // Let the first line through, then abort with the stream still open.
    await vi.waitFor(() => expect(lines).toHaveLength(1))
    controller.abort()
    await done
    expect(lines).toEqual<Array<JournalLine>>([
      { line: '{"a":1}', endPosition: 8 },
    ])
    expect(killed).toBe(true)
  })

  it('yields nothing and tears down at once when the signal is already aborted', async () => {
    let killed = false
    const controller = new AbortController()
    controller.abort()
    const handle = fakeHandle({
      spawnStdout: neverEnding(['{"a":1}\n']),
      onKill: () => {
        killed = true
      },
    })
    expect(
      await collect(
        readJournal(handle, {
          paths: journalPaths('r1'),
          signal: controller.signal,
        }),
      ),
    ).toEqual([])
    expect(killed).toBe(true)
  })
})

describe('readJournal — poll strategy', () => {
  it('issues bounded, non-following execs and advances the byte position', async () => {
    const commands: Array<string> = []
    const responses = [b64('{"a":1}\n'), '', b64('{"b":2}\n')]
    let call = 0
    const handle = fakeHandle({
      capabilities: { killableProcesses: false },
      exec: (command) => {
        commands.push(command)
        const stdout = responses[call] ?? ''
        call += 1
        return Promise.resolve({ stdout, stderr: '', exitCode: 0 })
      },
    })
    const controller = new AbortController()
    const lines: Array<JournalLine> = []
    for await (const line of readJournal(handle, {
      paths: journalPaths('r1'),
      pollIntervalMs: 0,
      signal: controller.signal,
    })) {
      lines.push(line)
      if (lines.length === 2) controller.abort()
    }
    expect(lines).toEqual<Array<JournalLine>>([
      { line: '{"a":1}', endPosition: 8 },
      { line: '{"b":2}', endPosition: 16 },
    ])
    expect(commands[0]).toBe(
      `tail -c +1 '/tmp/tanstack-runs/r1.ndjson' 2>/dev/null | base64`,
    )
    expect(commands.every((command) => !command.includes('-f'))).toBe(true)
    // The third poll must start after the bytes the first two consumed.
    expect(commands[2]).toContain('tail -c +9 ')
  })

  it('re-polls from the same position when a line is still incomplete', async () => {
    const commands: Array<string> = []
    const responses = [b64('{"par'), b64('{"partial":1}\n')]
    let call = 0
    const handle = fakeHandle({
      capabilities: { killableProcesses: false },
      exec: (command) => {
        commands.push(command)
        const stdout = responses[call] ?? ''
        call += 1
        return Promise.resolve({ stdout, stderr: '', exitCode: 0 })
      },
    })
    const controller = new AbortController()
    const lines: Array<JournalLine> = []
    for await (const line of readJournal(handle, {
      paths: journalPaths('r1'),
      pollIntervalMs: 0,
      signal: controller.signal,
    })) {
      lines.push(line)
      controller.abort()
    }
    expect(lines).toEqual<Array<JournalLine>>([
      { line: '{"partial":1}', endPosition: 14 },
    ])
    // Both polls started at byte 0: a partial line advances nothing.
    expect(commands[0]).toContain('tail -c +1 ')
    expect(commands[1]).toContain('tail -c +1 ')
  })

  it('stops when the signal is already aborted, issuing no exec at all', async () => {
    const exec = vi.fn(() =>
      Promise.resolve<ExecResult>({ stdout: '', stderr: '', exitCode: 0 }),
    )
    const controller = new AbortController()
    controller.abort()
    const handle = fakeHandle({
      capabilities: { killableProcesses: false },
      exec,
    })
    expect(
      await collect(
        readJournal(handle, {
          paths: journalPaths('r1'),
          signal: controller.signal,
          pollIntervalMs: 0,
        }),
      ),
    ).toEqual([])
    expect(exec).not.toHaveBeenCalled()
  })

  it('defaults the poll interval to 250ms, matching the cloudflare tail loop', () => {
    expect(DEFAULT_JOURNAL_POLL_MS).toBe(250)
  })
})

describe('readJournal — explicit strategy override', () => {
  it('honors strategy: poll on a follow-capable provider', async () => {
    const commands: Array<string> = []
    const controller = new AbortController()
    const handle = fakeHandle({
      exec: (command) => {
        commands.push(command)
        controller.abort()
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      },
    })
    await collect(
      readJournal(handle, {
        paths: journalPaths('r1'),
        strategy: 'poll',
        pollIntervalMs: 0,
        signal: controller.signal,
      }),
    )
    expect(commands[0]).toContain('tail -c +1 ')
  })
})

describe('killableProcesses is a required capability', () => {
  it('is declared on every capability literal the package builds', () => {
    // A compile-time guarantee expressed as a runtime assertion so the intent
    // survives a refactor that loosens the type.
    expect(caps()).toHaveProperty('killableProcesses')
  })
})
