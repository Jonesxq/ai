import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JOURNAL_DIR,
  journalExistsCommand,
  journalFollowCommand,
  journalPaths,
  journalReadCommand,
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
      `tail -c +1 -f '/tmp/tanstack-runs/r1.ndjson' 2>/dev/null | base64`,
    )
    expect(journalFollowCommand(paths, 100)).toBe(
      `tail -c +101 -f '/tmp/tanstack-runs/r1.ndjson' 2>/dev/null | base64`,
    )
  })

  it('the bounded read is identical minus -f, so a poll cannot hang', () => {
    const paths = journalPaths('r1')
    expect(journalReadCommand(paths, 100)).toBe(
      `tail -c +101 '/tmp/tanstack-runs/r1.ndjson' 2>/dev/null | base64`,
    )
    expect(journalReadCommand(paths, 100)).not.toContain('-f')
  })

  it('silences stderr and base64-frames both reads', () => {
    const paths = journalPaths('r1')
    for (const cmd of [
      journalFollowCommand(paths, 0),
      journalReadCommand(paths, 0),
    ]) {
      expect(cmd).toContain('2>/dev/null')
      expect(cmd).toContain('| base64')
    }
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
