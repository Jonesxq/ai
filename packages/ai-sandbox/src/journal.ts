/**
 * The agent output journal: an append-only NDJSON file INSIDE the sandbox that
 * the agent's stdout is redirected to, and that the host tails.
 *
 * This module is pure string composition — no I/O — so every shell fragment the
 * feature depends on is unit-testable without a sandbox, and a successor host
 * derives byte-identical commands from the `runId` alone.
 *
 * Three rules are encoded here and must not be relaxed:
 *
 * 1. **No pipe from the agent.** The agent's stdout is *redirected*, never
 *    piped. `agent | tee file` gives the agent a reader whose disappearance
 *    SIGPIPEs it — precisely the host-death failure this feature exists to
 *    prevent. Redirection leaves nothing to break.
 * 2. **Every read silences stderr and base64-frames its output.** Daytona's
 *    `exec` folds stderr into stdout (`stderr: ''`, by contract) and Sprites'
 *    fast path does too, so a `tail` diagnostic would otherwise splice itself
 *    into the event bytes. base64 additionally makes byte accounting exact:
 *    `SpawnHandle.stdout` is `AsyncIterable<string>` already decoded by the
 *    provider with unspecified decoder behavior, so counting bytes off it is
 *    not portable. An ASCII-safe frame we decode ourselves is.
 * 3. **The journal is touched ONLY through the shell.** On local-process,
 *    `fs.write` resolves `/tmp` under the sandbox root while a shell redirect
 *    hits the real host `/tmp`. Both halves agree with each other only as long
 *    as nothing uses `fs.*` here — hence {@link journalExistsCommand} rather
 *    than `handle.fs.exists`.
 *
 * The composed commands below are handed to two different execution
 * mechanisms depending on provider, not always `sh -c`: daytona hands the raw
 * string to `executeCommand` with an `export`-prefixed env, and cloudflare
 * hands it to a Durable Object RPC. Redirection, `mkdir -p`, `tail`, and
 * `base64` all still work because both paths are shell-interpreted
 * downstream — the doc comment intentionally does not claim every provider
 * wraps the command in `sh -c` itself.
 */

/** Default journal directory. `/tmp` is the convention the harness adapters already use. */
export const DEFAULT_JOURNAL_DIR = '/tmp/tanstack-runs'

/**
 * Key of the sentinel object the journaled command appends after the agent
 * exits. It tells a *new* host the agent finished, with no pid probe and no
 * provider-specific liveness API — which matters because `pid` is `-1` on five
 * of six providers.
 */
export const EXIT_SENTINEL_KEY = '__exit'

/** Absolute in-sandbox paths for one run's journal. */
export interface JournalPaths {
  /** Directory both files live in; created by {@link journaledCommand}. */
  dir: string
  /** Append-only NDJSON file the agent's stdout is redirected to. */
  journal: string
  /** Separate file the agent's stderr goes to; NEVER mixed into the journal. */
  stderr: string
}

/** Single-quote a shell word, escaping embedded single quotes POSIX-style. */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`
}

/**
 * Map a runId to a filename-safe token.
 *
 * Encoding rather than rejecting keeps the mapping total: a client may choose
 * any `runId`, and a run that cannot be journaled would be a run that cannot be
 * made durable. The encoding is a pure function of the input, which is what lets
 * a successor host recompute the same path from the run record alone.
 */
function encodeRunId(runId: string): string {
  if (runId.length === 0) {
    throw new Error('journal: runId must not be empty')
  }
  let out = ''
  for (const char of runId) {
    if (/^[A-Za-z0-9._-]$/.test(char)) {
      out += char
      continue
    }
    for (const byte of new TextEncoder().encode(char)) {
      out += `_${byte.toString(16).padStart(2, '0')}`
    }
  }
  return out
}

/** Derive both journal paths for a run. Pure; no I/O. */
export function journalPaths(
  runId: string,
  dir: string = DEFAULT_JOURNAL_DIR,
): JournalPaths {
  const normalizedDir = dir.endsWith('/') ? dir.slice(0, -1) : dir
  const name = encodeRunId(runId)
  return {
    dir: normalizedDir,
    journal: `${normalizedDir}/${name}.ndjson`,
    stderr: `${normalizedDir}/${name}.err`,
  }
}

/**
 * Wrap an agent command so its stdout lands in the journal, its stderr lands in
 * the sidecar file, and an `{"__exit":N}` sentinel is appended once it exits.
 *
 * `command` is interpolated raw: callers build real shell text (the Claude Code
 * and Codex adapters append `< promptFile`, for instance), so quoting it would
 * break them. Every path this module contributes IS quoted.
 *
 * `>>` rather than `>` on purpose: truncating would let a stray re-spawn destroy
 * a prefix a previous host already translated and delivered.
 */
export function journaledCommand(command: string, paths: JournalPaths): string {
  return (
    `mkdir -p ${shellQuote(paths.dir)} && ` +
    `{ ${command}; printf '{"${EXIT_SENTINEL_KEY}":%d}\\n' "$?"; } ` +
    `>> ${shellQuote(paths.journal)} 2>> ${shellQuote(paths.stderr)}`
  )
}

/**
 * `tail -c +N` is 1-based over bytes, while `fromByte` is a 0-based count of
 * bytes already consumed. `+fromByte + 1` is therefore "the first byte we have
 * not seen".
 */
function tailFrom(fromByte: number): number {
  if (!Number.isSafeInteger(fromByte) || fromByte < 0) {
    throw new Error(
      `journal: fromByte must be a non-negative safe integer, got ${fromByte}`,
    )
  }
  return fromByte + 1
}

/**
 * Following read, for `process.spawn` only. Never pass this to `exec`:
 * `ProcessOptions` has no timeout, so a following `exec` blocks until the
 * sandbox or the RPC times out.
 */
export function journalFollowCommand(
  paths: JournalPaths,
  fromByte: number,
): string {
  return `tail -c +${tailFrom(fromByte)} -f ${shellQuote(paths.journal)} 2>/dev/null | base64`
}

/**
 * Bounded read: identical minus `-f`, so it always terminates. This is the
 * Cloudflare path, whose `spawn` cannot be killed and whose `exec` drops the
 * AbortSignal, making a following read unstoppable there.
 */
export function journalReadCommand(
  paths: JournalPaths,
  fromByte: number,
): string {
  return `tail -c +${tailFrom(fromByte)} ${shellQuote(paths.journal)} 2>/dev/null | base64`
}

/**
 * Existence probe. A shell `test -f`, not `handle.fs.exists`: see rule 3 in the
 * module doc — on local-process the two resolve `/tmp` differently.
 */
export function journalExistsCommand(paths: JournalPaths): string {
  return `test -f ${shellQuote(paths.journal)}`
}
