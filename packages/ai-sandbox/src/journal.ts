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
 * 2. **Every read silences stderr; only the BOUNDED read base64-frames its
 *    output.** `2>/dev/null` is on both: Daytona's `exec` folds stderr into
 *    stdout (`stderr: ''`, by contract) and Sprites' fast path does too, so a
 *    `tail` diagnostic would otherwise splice itself into the event bytes.
 *    Silencing it inside the sandbox means there is nothing left to fold.
 *
 *    base64, however, is only on {@link journalReadCommand}. It cannot be on
 *    {@link journalFollowCommand}: `base64` fully buffers its stdout when that
 *    is a pipe rather than a tty, so `tail -f file | base64` emits NOTHING
 *    until the ~4KB libc stdio buffer fills or `base64`'s stdin closes — and
 *    `tail -f`'s stdin never closes until the reader kills it, by which point
 *    the consumer has stopped reading. Measured on GNU coreutils 8.32 `base64`
 *    (0 bytes delivered over 12s) and on busybox 1.36.1 `base64` in Alpine
 *    (identical), so it is a property of stdio, not of a provider or an OS.
 *    `stdbuf -o0` does not fix it portably (absent from busybox entirely) and
 *    re-`exec`ing `base64` per line costs a fork per journal event.
 *
 *    Dropping it from the follow path is safe because the bounded read keeps
 *    every property base64 was chosen for where that path needs them, and the
 *    follow path needs none of them: `2>/dev/null` already prevents the
 *    stderr splice, the journal is line-delimited JSON (a raw newline can only
 *    ever be a record separator — inside a JSON string it is `\n`), and
 *    `journal-bytes.ts` reassembles bytes across chunk boundaries and yields
 *    only newline-terminated lines. The follow path therefore consumes
 *    `SpawnHandle.stdout` exactly as `runner.ts` already consumes the agent's
 *    own stdout, i.e. it relies on the same provider decoding contract the
 *    package already depends on rather than a stricter one.
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

/**
 * Derive both journal paths for a run. Pure; no I/O.
 *
 * **`runId` MUST be unique per run.** The journal is append-only by design (a
 * takeover depends on a prefix a previous host delivered still being there), and
 * {@link DEFAULT_JOURNAL_DIR} is a fixed absolute path that outlives any single
 * sandbox, test, or process. So a reused `runId` does not start a fresh journal
 * — it appends to the old one, behind the old run's `{"__exit":N}` sentinel. A
 * reader stops at the FIRST sentinel it sees, so the new run appears to emit
 * nothing at all, or to fail with the previous run's exit code. This is not
 * enforced here on purpose: refusing to append would break the takeover the
 * append-only rule exists for. Callers derive `runId` from something unique
 * (the adapters use a timestamp plus a random suffix); a test that hardcodes a
 * literal `runId` will observe a stale run's journal on its second execution.
 */
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
    // `command` runs inside its OWN subshell `( … )`, not merely a `{ … }`
    // group: a group runs in the CURRENT shell, so a bare `exit` inside
    // `command` (an agent legitimately calling `exit N`) would terminate the
    // whole compound statement before the sentinel `printf` ever ran — the
    // journal would end with no `__exit` line at all. A subshell gives
    // `exit` its own process to terminate, leaving `$?` (the subshell's exit
    // status) and the following `printf` intact in the outer shell.
    `{ ( ${command} ); printf '{"${EXIT_SENTINEL_KEY}":%d}\\n' "$?"; } ` +
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
 *
 * Deliberately pipes into NOTHING. `tail -f` flushes each append as it sees it,
 * so it is the one stage in this pipeline that streams; adding any filter puts
 * that filter's stdio buffer between the agent and the host and the follow
 * strategy stops following (see rule 2 in the module doc for the measurements).
 * The host turns these raw bytes into positioned lines with
 * `journal-bytes.ts`.
 *
 * It also creates the journal before tailing it, because `tail -f` on a path
 * that does not exist yet prints a diagnostic and EXITS rather than waiting —
 * so the reader would deliver zero lines for a run whose journal simply had not
 * been created yet. The reader and the agent are two independent spawns and
 * nothing orders them, so that race is the normal case, not the unlucky one.
 * `: >> file` is a builtin no-op plus an O_CREAT|O_APPEND open: it creates the
 * file when absent and, critically, does NOT truncate one that already has a
 * prefix a previous host already delivered. `;` rather than `&&` throughout, so
 * a prep step that fails still lets the `tail` run and fail the way it used to
 * rather than turning a read into a silent no-op. (`tail -F` would also retry,
 * but `-F` is a GNU/busybox extension, not POSIX, and this file only emits
 * POSIX shell.)
 */
export function journalFollowCommand(
  paths: JournalPaths,
  fromByte: number,
): string {
  return (
    `mkdir -p ${shellQuote(paths.dir)} 2>/dev/null; ` +
    `: >> ${shellQuote(paths.journal)} 2>/dev/null; ` +
    `tail -c +${tailFrom(fromByte)} -f ${shellQuote(paths.journal)} 2>/dev/null`
  )
}

/**
 * Bounded read: `-f` dropped so it always terminates, and base64-framed because
 * it can be — `exec` closes `base64`'s stdin, which flushes it, and the whole
 * result arrives as one already-complete `ExecResult.stdout` string. This is the
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
