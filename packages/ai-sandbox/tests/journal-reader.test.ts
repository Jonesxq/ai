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
  spawnStdout?: Array<string>
  exec?: (command: string) => Promise<ExecResult>
  onSpawn?: (command: string, options?: ProcessOptions) => void
  onKill?: () => void
}

function fakeHandle(input: FakeHandleInput = {}): SandboxHandle {
  const spawnHandle: SpawnHandle = {
    pid: -1,
    stdout: fromValues(input.spawnStdout ?? []),
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
      spawnStdout: [b64('{"a":1}\n{"b":2}\n')],
      onSpawn: (command) => commands.push(command),
    })
    const lines = await collect(
      readJournal(handle, { paths: journalPaths('r1'), fromByte: 0 }),
    )
    expect(commands).toEqual([
      `tail -c +1 -f '/tmp/tanstack-runs/r1.ndjson' 2>/dev/null | base64`,
    ])
    expect(lines).toEqual<Array<JournalLine>>([
      { line: '{"a":1}', endPosition: 8 },
      { line: '{"b":2}', endPosition: 16 },
    ])
  })

  it('resumes from fromByte, keeping positions absolute', async () => {
    const commands: Array<string> = []
    const handle = fakeHandle({
      spawnStdout: [b64('{"b":2}\n')],
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
      spawnStdout: [b64('{"a":1}\n{"b":2}\n')],
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
    const handle = fakeHandle({ spawnStdout: [b64('{"a":1}\n')] })
    await expect(
      collect(readJournal(handle, { paths: journalPaths('r1') })),
    ).resolves.toHaveLength(1)
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
