import { describe, expect, it } from 'vitest'
import {
  readJournalNdjson,
  spawnNdjson,
  startJournaledAgent,
  toLines,
} from '../src/runner'
import type { SandboxHandle, SpawnHandle } from '../src/contracts'

async function* fromChunks(chunks: Array<string>): AsyncIterable<string> {
  for (const c of chunks) {
    // Yield asynchronously to mimic real stream scheduling.
    await Promise.resolve()
    yield c
  }
}

async function collect<T>(it: AsyncIterable<T>): Promise<Array<T>> {
  const out: Array<T> = []
  for await (const v of it) out.push(v)
  return out
}

/** Minimal handle whose process.spawn replays scripted stdout chunks. */
function handleSpawning(chunks: Array<string>): SandboxHandle {
  const spawnHandle: SpawnHandle = {
    pid: 1,
    stdout: fromChunks(chunks),
    stderr: fromChunks([]),
    stdin: { write: () => Promise.resolve(), end: () => Promise.resolve() },
    wait: () => Promise.resolve(0),
    kill: () => Promise.resolve(),
  }
  return {
    id: 'fake',
    provider: 'fake',
    capabilities: {
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
    },
    // Only process.spawn is exercised here.
    fs: {} as SandboxHandle['fs'],
    git: {} as SandboxHandle['git'],
    process: {
      exec: () => Promise.reject(new Error('unused')),
      spawn: () => Promise.resolve(spawnHandle),
    },
    ports: { connect: () => Promise.reject(new Error('unused')) },
    env: { set: () => Promise.resolve() },
    destroy: () => Promise.resolve(),
  }
}

describe('toLines', () => {
  it('reassembles lines split across chunk boundaries', async () => {
    const lines = await collect(
      toLines(fromChunks(['{"a":', '1}\n{"b":2', '}\n'])),
    )
    expect(lines).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('emits a trailing unterminated line', async () => {
    const lines = await collect(toLines(fromChunks(['one\ntwo'])))
    expect(lines).toEqual(['one', 'two'])
  })
})

describe('spawnNdjson', () => {
  it('parses NDJSON events from stdout, skipping blank + non-JSON lines', async () => {
    const nonJson: Array<string> = []
    const handle = handleSpawning([
      'Claude Code starting...\n', // banner -> onNonJsonLine
      '{"type":"text","delta":"hi"}\n',
      '\n', // blank -> skipped
      '{"type":"result","ok":true}\n',
    ])
    const events = await collect(
      spawnNdjson(handle, 'claude -p --output-format stream-json', {
        onNonJsonLine: (l) => nonJson.push(l),
      }),
    )
    expect(events).toEqual([
      { type: 'text', delta: 'hi' },
      { type: 'result', ok: true },
    ])
    expect(nonJson).toEqual(['Claude Code starting...'])
  })
})

function b64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

/** Handle that records commands and replays scripted stdout per spawn call. */
function scriptedHandle(scripts: Array<Array<string>>): {
  handle: SandboxHandle
  commands: Array<string>
} {
  const commands: Array<string> = []
  let call = 0
  const handle: SandboxHandle = {
    ...handleSpawning([]),
    process: {
      exec: (command) => {
        commands.push(command)
        return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 })
      },
      spawn: (command) => {
        commands.push(command)
        const script = scripts[call] ?? []
        call += 1
        return Promise.resolve({
          pid: -1,
          stdout: fromChunks(script),
          stderr: fromChunks([]),
          stdin: {
            write: () => Promise.resolve(),
            end: () => Promise.resolve(),
          },
          wait: () => Promise.resolve(0),
          kill: () => Promise.resolve(),
        })
      },
    },
  }
  return { handle, commands }
}

describe('startJournaledAgent', () => {
  it('spawns the agent with stdout redirected to the journal and does not read it', async () => {
    const { handle, commands } = scriptedHandle([[]])
    await startJournaledAgent(handle, 'claude -p', { journal: { runId: 'r1' } })
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain(`>> '/tmp/tanstack-runs/r1.ndjson'`)
    expect(commands[0]).toContain(`2>> '/tmp/tanstack-runs/r1.err'`)
    expect(commands[0]).toContain('claude -p')
  })

  it('writes stdin input then closes it, exactly as the unjournaled path does', async () => {
    const written: Array<string> = []
    let ended = false
    const base = handleSpawning([])
    const handle: SandboxHandle = {
      ...base,
      process: {
        exec: () => Promise.reject(new Error('unused')),
        spawn: () =>
          Promise.resolve({
            pid: -1,
            stdout: fromChunks([]),
            stderr: fromChunks([]),
            stdin: {
              write: (data: string) => {
                written.push(data)
                return Promise.resolve()
              },
              end: () => {
                ended = true
                return Promise.resolve()
              },
            },
            wait: () => Promise.resolve(0),
            kill: () => Promise.resolve(),
          }),
      },
    }
    await startJournaledAgent(handle, 'codex exec', {
      journal: { runId: 'r1' },
      input: 'the prompt',
    })
    expect(written).toEqual(['the prompt'])
    expect(ended).toBe(true)
  })

  it('returns without awaiting the agent process (a hung wait() must not block the trigger)', async () => {
    let waitCalled = false
    const base = handleSpawning([])
    const handle: SandboxHandle = {
      ...base,
      process: {
        exec: () => Promise.reject(new Error('unused')),
        spawn: () =>
          Promise.resolve({
            pid: -1,
            stdout: fromChunks([]),
            stderr: fromChunks([]),
            stdin: {
              write: () => Promise.resolve(),
              end: () => Promise.resolve(),
            },
            // Never resolves. If startJournaledAgent awaited this, the test
            // would hang until Vitest's timeout — the whole point of
            // journaling is that the trigger returns immediately while the
            // agent keeps running.
            wait: () =>
              new Promise<number>(() => {
                waitCalled = true
              }),
            kill: () => Promise.resolve(),
          }),
      },
    }
    await startJournaledAgent(handle, 'agent', { journal: { runId: 'r1' } })
    // Reaching here at all proves startJournaledAgent did not await wait().
    expect(waitCalled).toBe(false)
  })
})

describe('readJournalNdjson', () => {
  it('parses journal lines as JSON and stops at the exit sentinel', async () => {
    const { handle } = scriptedHandle([
      [b64('{"a":1}\n{"b":2}\n{"__exit":0}\n')],
    ])
    expect(
      await collect(readJournalNdjson(handle, { journal: { runId: 'r1' } })),
    ).toEqual([{ a: 1 }, { b: 2 }])
  })

  it('throws on a non-zero exit sentinel so the adapter emits RUN_ERROR', async () => {
    const { handle } = scriptedHandle([[b64('{"a":1}\n{"__exit":7}\n')]])
    await expect(
      collect(readJournalNdjson(handle, { journal: { runId: 'r1' } })),
    ).rejects.toThrow(/exited with code 7/)
  })

  it('routes a non-JSON line to onNonJsonLine instead of failing the run', async () => {
    const seen: Array<string> = []
    const { handle } = scriptedHandle([
      [b64('Claude Code starting...\n{"a":1}\n{"__exit":0}\n')],
    ])
    expect(
      await collect(
        readJournalNdjson(handle, {
          journal: { runId: 'r1' },
          onNonJsonLine: (line) => seen.push(line),
        }),
      ),
    ).toEqual([{ a: 1 }])
    expect(seen).toEqual(['Claude Code starting...'])
  })

  it('reads from byte 0 on attach, so alignment sees the whole run', async () => {
    const { handle, commands } = scriptedHandle([[b64('{"__exit":0}\n')]])
    await collect(
      readJournalNdjson(handle, { journal: { runId: 'r1', attach: true } }),
    )
    expect(commands[0]).toContain('tail -c +1 -f')
  })
})

describe('spawnNdjson with journaling', () => {
  it('starts the agent journaled and reads the journal back, one code path', async () => {
    const { handle, commands } = scriptedHandle([
      [], // the agent spawn
      [b64('{"a":1}\n{"__exit":0}\n')], // the tail spawn
    ])
    expect(
      await collect(spawnNdjson(handle, 'agent', { journal: { runId: 'r1' } })),
    ).toEqual([{ a: 1 }])
    expect(commands[0]).toContain(`>> '/tmp/tanstack-runs/r1.ndjson'`)
    expect(commands[1]).toContain(
      `tail -c +1 -f '/tmp/tanstack-runs/r1.ndjson'`,
    )
  })

  it('skips the agent spawn when attaching to a run already in flight', async () => {
    const { handle, commands } = scriptedHandle([[b64('{"__exit":0}\n')]])
    await collect(
      spawnNdjson(handle, 'agent', { journal: { runId: 'r1', attach: true } }),
    )
    expect(commands).toHaveLength(1)
    expect(commands[0]).toContain('tail -c +1 -f')
  })

  it('keeps the unjournaled path byte-identical when no journal option is passed', async () => {
    const handle = handleSpawning(['{"a":1}\n'])
    expect(await collect(spawnNdjson(handle, 'agent'))).toEqual([{ a: 1 }])
  })
})
