import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JOURNAL_DIR,
  journalCleanupCommand,
  journalExistsCommand,
  journalFollowCommand,
  journalPaths,
  journalReadCommand,
  journalStderrReadCommand,
  journaledCommand,
} from '../src/journal'

describe('journalPaths', () => {
  it('derives both files under the default directory from the runId alone', () => {
    const paths = journalPaths('run-123')
    expect(paths.dir).toBe(DEFAULT_JOURNAL_DIR)
    expect(paths.journal).toBe('/tmp/tanstack-runs/run-123.ndjson')
    expect(paths.stderr).toBe('/tmp/tanstack-runs/run-123.err')
  })

  it('is a pure function of the runId, so a successor host derives the same paths', () => {
    expect(journalPaths('run-123')).toEqual(journalPaths('run-123'))
  })

  it('honors an explicit directory without a trailing slash', () => {
    expect(journalPaths('r', '/var/journals/').journal).toBe(
      '/var/journals/r.ndjson',
    )
  })

  it('encodes characters that are unsafe in a filename or a shell word', () => {
    // A client-chosen runId can contain anything. Encoding, not rejecting,
    // keeps the mapping total AND deterministic across hosts.
    const paths = journalPaths('a/b c;d')
    expect(paths.journal).toBe('/tmp/tanstack-runs/a_2fb_20c_3bd.ndjson')
  })

  it('rejects an empty runId rather than writing to a bare extension', () => {
    expect(() => journalPaths('')).toThrow(/runId/)
  })
})

describe('journaledCommand', () => {
  it('redirects stdout to the journal, stderr to its own file, and appends the exit sentinel', () => {
    const paths = journalPaths('r1')
    expect(
      journaledCommand('claude -p --output-format stream-json', paths),
    ).toBe(
      `mkdir -p '/tmp/tanstack-runs' && ` +
        `{ ( claude -p --output-format stream-json ); printf '{"__exit":%d}\\n' "$?"; } ` +
        `>> '/tmp/tanstack-runs/r1.ndjson' 2>> '/tmp/tanstack-runs/r1.err'`,
    )
  })

  it('appends rather than truncates, so a re-spawn cannot destroy a prior prefix', () => {
    expect(journaledCommand('x', journalPaths('r1'))).toContain(
      `>> '/tmp/tanstack-runs/r1.ndjson'`,
    )
    expect(journaledCommand('x', journalPaths('r1'))).not.toContain(
      `> '/tmp/tanstack-runs/r1.ndjson'\n`,
    )
  })

  it('does not pipe the agent into anything (no tee: SIGPIPE would kill it)', () => {
    expect(journaledCommand('agent', journalPaths('r1'))).not.toContain('|')
  })

  it('quotes an adversarial runId so it cannot inject shell metacharacters', () => {
    const paths = journalPaths(`a'; rm -rf /; echo $(whoami) "b`)
    const cmd = journaledCommand('agent', paths)
    // Every interpolated path is single-quoted; embedded single quotes are
    // escaped with the POSIX '\'' idiom rather than left to break out of quoting.
    expect(cmd).toContain(`>> ${`'${paths.journal.replaceAll("'", `'\\''`)}'`}`)
    expect(cmd).toContain(`2>> ${`'${paths.stderr.replaceAll("'", `'\\''`)}'`}`)
    expect(cmd).not.toContain('rm -rf /')
    expect(cmd).not.toContain('$(whoami)')
  })
})

describe('journalFollowCommand / journalReadCommand', () => {
  it('translates a 0-based consumed-byte count into tail -c +N (1-based)', () => {
    const paths = journalPaths('r1')
    expect(journalFollowCommand(paths, 0)).toBe(
      `mkdir -p '/tmp/tanstack-runs' 2>/dev/null; ` +
        `: >> '/tmp/tanstack-runs/r1.ndjson' 2>/dev/null; ` +
        `tail -c +1 -f '/tmp/tanstack-runs/r1.ndjson' 2>/dev/null`,
    )
    expect(journalFollowCommand(paths, 100)).toContain(
      `tail -c +101 -f '/tmp/tanstack-runs/r1.ndjson' 2>/dev/null`,
    )
  })

  it('creates the journal before following it, so tail cannot exit on a missing file', () => {
    // The agent spawn and the reader spawn are unordered, so the reader
    // routinely wins the race. `tail -f` on a nonexistent path exits instead of
    // waiting, which would silently deliver zero lines for the whole run.
    const cmd = journalFollowCommand(journalPaths('r1'), 0)
    expect(cmd).toContain(`: >> '/tmp/tanstack-runs/r1.ndjson'`)
    // Append, never truncate: a prefix a previous host delivered must survive.
    expect(cmd).not.toContain(`: > '/tmp/tanstack-runs/r1.ndjson'`)
    expect(cmd.indexOf(': >>')).toBeLessThan(cmd.indexOf('tail -c'))
  })

  it('the bounded read drops -f and keeps the base64 frame, so a poll cannot hang', () => {
    const paths = journalPaths('r1')
    expect(journalReadCommand(paths, 100)).toBe(
      `tail -c +101 '/tmp/tanstack-runs/r1.ndjson' 2>/dev/null | base64`,
    )
    expect(journalReadCommand(paths, 100)).not.toContain('-f')
  })

  it('silences stderr on both reads', () => {
    const paths = journalPaths('r1')
    for (const cmd of [
      journalFollowCommand(paths, 0),
      journalReadCommand(paths, 0),
    ]) {
      expect(cmd).toContain('2>/dev/null')
    }
  })

  it('never pipes the following read into a filter, which would buffer the stream', () => {
    // `base64` (GNU coreutils and busybox alike) buffers its stdout when it is
    // a pipe, so `tail -f … | base64` delivers nothing until the encoder's
    // stdin closes — i.e. until the reader kills `tail`, after the consumer has
    // given up. Any pipe at all on the follow path reintroduces some filter's
    // stdio buffer between the agent and the host, so assert there is none.
    expect(journalFollowCommand(journalPaths('r1'), 0)).not.toContain('|')
    // The bounded read is safe to frame: `exec` closes the encoder's stdin.
    expect(journalReadCommand(journalPaths('r1'), 0)).toContain('| base64')
  })

  it('rejects a negative byte position instead of emitting tail -c +0', () => {
    expect(() => journalReadCommand(journalPaths('r1'), -1)).toThrow(/fromByte/)
    expect(() => journalFollowCommand(journalPaths('r1'), -1)).toThrow(
      /fromByte/,
    )
  })
})

describe('journalExistsCommand', () => {
  it('probes through the shell, never through fs.*', () => {
    expect(journalExistsCommand(journalPaths('r1'))).toBe(
      `test -f '/tmp/tanstack-runs/r1.ndjson'`,
    )
  })
})

describe('journalStderrReadCommand', () => {
  it('reads a BOUNDED tail of the sidecar, base64-framed, stderr silenced', () => {
    expect(journalStderrReadCommand(journalPaths('r1'))).toBe(
      `tail -c -4096 '/tmp/tanstack-runs/r1.err' 2>/dev/null | base64`,
    )
  })

  it('reads the sidecar and never the journal', () => {
    const cmd = journalStderrReadCommand(journalPaths('r1'))
    expect(cmd).toContain(`'/tmp/tanstack-runs/r1.err'`)
    expect(cmd).not.toContain('.ndjson')
  })

  it('keeps the base64 frame and drops -f, because this is an exec read', () => {
    // Same reasoning as `journalReadCommand`: `exec` closes the encoder's stdin
    // so it flushes, and an unbounded following read would never terminate. The
    // sidecar is NOT line-delimited JSON, so the frame is what makes a provider
    // that folds stderr into stdout harmless here.
    const cmd = journalStderrReadCommand(journalPaths('r1'))
    expect(cmd).toContain('| base64')
    expect(cmd).not.toContain('-f ')
  })

  it('honors an explicit byte bound', () => {
    expect(journalStderrReadCommand(journalPaths('r1'), 64)).toContain(
      'tail -c -64',
    )
  })

  it('rejects a non-positive bound rather than emitting an unbounded read', () => {
    expect(() => journalStderrReadCommand(journalPaths('r1'), 0)).toThrow(
      /maxBytes/,
    )
    expect(() => journalStderrReadCommand(journalPaths('r1'), -5)).toThrow(
      /maxBytes/,
    )
    expect(() => journalStderrReadCommand(journalPaths('r1'), 1.5)).toThrow(
      /maxBytes/,
    )
  })

  it('quotes an adversarial runId so the sidecar read cannot inject shell', () => {
    const paths = journalPaths(`a'; rm -rf /; echo $(whoami)`)
    const cmd = journalStderrReadCommand(paths)
    expect(cmd).toContain(`'${paths.stderr.replaceAll("'", `'\\''`)}'`)
    expect(cmd).not.toContain('rm -rf /')
    expect(cmd).not.toContain('$(whoami)')
  })
})

describe('journalCleanupCommand', () => {
  it("removes BOTH of a run's files in one shell rm -f", () => {
    expect(journalCleanupCommand(journalPaths('r1'))).toBe(
      `rm -f '/tmp/tanstack-runs/r1.ndjson' '/tmp/tanstack-runs/r1.err'`,
    )
  })

  it('deletes through the shell, never through fs.* (rule 3)', () => {
    // On local-process, `/tmp` resolves under the sandbox root through `fs.*`
    // but to the host's real `/tmp` through the shell — an `fs.remove` would
    // delete a different path than `journaledCommand` wrote, i.e. nothing.
    // Asserting the exact string is how that stays true.
    expect(journalCleanupCommand(journalPaths('r1'))).toMatch(/^rm -f /)
  })

  it('uses -f so an already-deleted journal is a success, not an error', () => {
    // A provider may have reaped `/tmp`, or a successor host may have cleaned up
    // first. Neither is a failure of the run.
    expect(journalCleanupCommand(journalPaths('r1'))).toContain('rm -f')
  })

  it('quotes an adversarial runId so cleanup cannot rm anything else', () => {
    const paths = journalPaths(`a'; rm -rf /; echo $(whoami) "b`)
    const cmd = journalCleanupCommand(paths)
    expect(cmd).toContain(`'${paths.journal.replaceAll("'", `'\\''`)}'`)
    expect(cmd).toContain(`'${paths.stderr.replaceAll("'", `'\\''`)}'`)
    expect(cmd).not.toContain('rm -rf /')
    expect(cmd).not.toContain('$(whoami)')
  })

  it('never touches the journal DIRECTORY, which other runs share', () => {
    const cmd = journalCleanupCommand(journalPaths('r1'))
    // `-f` and nothing else: no `-r`, which is the flag that would let a
    // mis-derived path take the whole shared directory with it.
    expect(cmd.split(' ').filter((word) => word.startsWith('-'))).toEqual([
      '-f',
    ])
    expect(cmd).not.toContain(`'${DEFAULT_JOURNAL_DIR}'`)
  })
})
