/**
 * Provider conformance for the agent output journal.
 *
 * The journal design rests on two provider-level claims: a command string is
 * framed through a POSIX shell (so `>>` redirection works), and `tail -c +N -f`
 * is available. Both are asserted here against a real sandbox rather than
 * assumed from the audit.
 *
 * A provider that cannot satisfy them MUST declare `unsupported.reason`. There
 * is deliberately no silent-skip path: a conformance case that quietly returns
 * prints as a pass, which is how an unimplemented capability ships green.
 *
 * Vitest is an OPTIONAL peer dependency: this module is imported only from test
 * files, which already run under Vitest.
 */
import { describe, expect, it } from 'vitest'
import { journalPaths, journalReadCommand, journaledCommand } from '../journal'
import { journalReadStrategy, readJournal } from '../journal-reader'
import type { SandboxHandle } from '../contracts'

export interface JournalConformanceConfig {
  /** Provider name, used in the describe title. */
  name: string
  /** Create a live sandbox plus its teardown. */
  createHandle: () => Promise<{
    handle: SandboxHandle
    dispose: () => Promise<void>
  }>
  /**
   * Declare that this provider cannot journal, with the reason. Registers a
   * skipped case whose title carries the reason. Omit it and the suite runs.
   */
  unsupported?: { reason: string }
}

/** Decode the base64 frame a journal read command produces into raw text. */
function decodeJournalRead(stdout: string): string {
  return Buffer.from(stdout.replace(/\s+/g, ''), 'base64').toString('utf8')
}

/**
 * Assert `createHandle` satisfies the journal conformance contract. Each `it`
 * gets a fresh sandbox via `createHandle`/`dispose`, so implementations may
 * share process state across calls without cross-test bleed only if
 * `createHandle` returns an isolated sandbox.
 */
export function runJournalConformance(config: JournalConformanceConfig): void {
  describe(`journal conformance — ${config.name}`, () => {
    if (config.unsupported) {
      it.skip(`unsupported: ${config.unsupported.reason}`, () => {
        expect(true).toBe(true)
      })
      return
    }

    it("redirects a command's stdout into the journal and appends the exit sentinel", async () => {
      const { handle, dispose } = await config.createHandle()
      try {
        const paths = journalPaths(`conf-${Date.now()}`)
        const command = journaledCommand(`printf '{"a":1}\\n{"b":2}\\n'`, paths)
        const proc = await handle.process.spawn(command)
        expect(await proc.wait()).toBe(0)

        const read = await handle.process.exec(journalReadCommand(paths, 0))
        const text = decodeJournalRead(read.stdout)
        expect(text).toBe('{"a":1}\n{"b":2}\n{"__exit":0}\n')
      } finally {
        await dispose()
      }
    }, 60_000)

    it("records the agent's non-zero exit in the sentinel", async () => {
      const { handle, dispose } = await config.createHandle()
      try {
        const paths = journalPaths(`conf-exit-${Date.now()}`)
        const proc = await handle.process.spawn(
          journaledCommand('exit 7', paths),
        )
        await proc.wait()
        const read = await handle.process.exec(journalReadCommand(paths, 0))
        const text = decodeJournalRead(read.stdout)
        expect(text).toBe('{"__exit":7}\n')
      } finally {
        await dispose()
      }
    }, 60_000)

    it("keeps the agent's stderr out of the journal", async () => {
      const { handle, dispose } = await config.createHandle()
      try {
        const paths = journalPaths(`conf-err-${Date.now()}`)
        const proc = await handle.process.spawn(
          journaledCommand(
            `printf '{"a":1}\\n'; printf 'a warning\\n' 1>&2`,
            paths,
          ),
        )
        await proc.wait()
        const read = await handle.process.exec(journalReadCommand(paths, 0))
        const text = decodeJournalRead(read.stdout)
        expect(text).toBe('{"a":1}\n{"__exit":0}\n')
        expect(text).not.toContain('a warning')
      } finally {
        await dispose()
      }
    }, 60_000)

    it('reads incrementally from a byte offset with absolute positions', async () => {
      const { handle, dispose } = await config.createHandle()
      try {
        const paths = journalPaths(`conf-seek-${Date.now()}`)
        const proc = await handle.process.spawn(
          journaledCommand(`printf '{"a":1}\\n{"b":2}\\n'`, paths),
        )
        await proc.wait()

        const all = []
        for await (const line of readJournal(handle, {
          paths,
          fromByte: 0,
          strategy: 'poll',
          pollIntervalMs: 0,
          signal: AbortSignal.timeout(5_000),
        })) {
          all.push(line)
          if (all.length === 3) break
        }
        expect(all.map((l) => l.line)).toEqual([
          '{"a":1}',
          '{"b":2}',
          '{"__exit":0}',
        ])

        const resumed = []
        for await (const line of readJournal(handle, {
          paths,
          fromByte: all[0]?.endPosition ?? 0,
          strategy: 'poll',
          pollIntervalMs: 0,
          signal: AbortSignal.timeout(5_000),
        })) {
          resumed.push(line)
          if (resumed.length === 2) break
        }
        expect(resumed.map((l) => l.line)).toEqual(['{"b":2}', '{"__exit":0}'])
        expect(resumed[0]?.endPosition).toBe(all[1]?.endPosition)
      } finally {
        await dispose()
      }
    }, 60_000)

    // KNOWN FAILING against real sandboxes as of this writing (confirmed on
    // native git-bash `sh`/GNU coreutils `base64` AND inside a real Alpine
    // Linux Docker container with busybox `base64` — this is not a
    // Windows/local-process quirk). `base64` fully buffers its stdout when it
    // is not a tty (the classic ~4KB libc stdio buffer), so `tail -f file |
    // base64` emits NOTHING until either that buffer fills or `base64`'s
    // stdin (the read end from `tail`) closes — i.e. until `followJournal`'s
    // `finally` kills `tail`, by which point the consumer has already stopped
    // reading. The follow strategy's core promise — live, incremental
    // delivery of small journal lines — is not met by any base64
    // implementation tested. Left as a real, visible failure rather than
    // silenced with `.skip`/`.fails`, per this suite's no-silent-skip
    // contract: this is a genuine defect in `journalFollowCommand`
    // (`../journal.ts`) / the follow encoding pipeline, not a test bug, and it
    // needs a design fix (e.g. dropping base64 framing from the follow path,
    // or forcing unbuffered output some other way) before the follow strategy
    // can be relied on.
    it('follows a journal that is still being written, when the provider can', async () => {
      const { handle, dispose } = await config.createHandle()
      try {
        if (journalReadStrategy(handle) !== 'follow') {
          // Not a silent skip: assert the declared capability instead, so this
          // case still verifies something about the provider.
          expect(handle.capabilities.killableProcesses).toBe(false)
          return
        }
        const paths = journalPaths(`conf-follow-${Date.now()}`)
        void handle.process.spawn(
          journaledCommand(
            `printf '{"a":1}\\n'; sleep 1; printf '{"b":2}\\n'`,
            paths,
          ),
        )
        const seen: Array<string> = []
        for await (const line of readJournal(handle, {
          paths,
          fromByte: 0,
          signal: AbortSignal.timeout(15_000),
        })) {
          seen.push(line.line)
          if (seen.length === 3) break
        }
        expect(seen).toEqual(['{"a":1}', '{"b":2}', '{"__exit":0}'])
      } finally {
        await dispose()
      }
    }, 60_000)
  })
}
