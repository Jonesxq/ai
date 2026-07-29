---
name: ai-sandbox
description: >
  Run harness adapters (Claude Code, Codex, OpenCode) INSIDE
  isolated sandboxes via defineSandbox + withSandbox + a provider
  (localProcessSandbox / dockerSandbox). Covers declarative provisioning:
  createSecrets + secret/bearer, skills (agentSkill/gitSkill/mcpSkill/
  fileSkill), plugins, instructions → canonical AGENTS.md + symlinks projected
  per harness; shallow-clone default with depth opt-out; serial/parallel setup
  callback over a persistent shell; snapshot-after-setup default with
  snapshotMaxAge TTL; defineWorkspace (git/setup/scripts/skills/secrets/
  instructions/plugins), defineSandboxPolicy (allow/ask/deny), lifecycle/resume,
  the SandboxHandle (fs/git/process/ports), capability tokens, defineSandbox
  hooks (onFile/onFileCreate/onFileChange/onFileDelete/onReady/onError/
  onDestroy) + fileEvents flag, chat middleware sandbox group
  (defineChatMiddleware sandbox hooks), the sandbox debug category,
  watchWorkspace as a low-level building block, the file.changed /
  sandbox.file / claude-code.session-id events, and the run journal
  (spawnNdjson journal option, runId uniqueness, follow vs bounded-poll
  reading, alignToStoredLog replay alignment, chunkFingerprint,
  createRunScopedIdGen). Use whenever a harness adapter needs a sandbox or
  when building sandbox providers.
type: sub-skill
library: tanstack-ai
library_version: '0.1.0'
sources:
  - 'TanStack/ai:docs/sandbox/overview.md'
---

# Sandboxes

Harness adapters declare `requires: [SandboxCapability]`. `chat()` errors unless
some middleware provides it — `withSandbox(...)` does. The adapter then runs the
agent CLI **inside** the sandbox and streams its events back.

## Setup — Claude Code in a Docker sandbox

```typescript
import { chat } from '@tanstack/ai'
import { claudeCodeText } from '@tanstack/ai-claude-code'
import {
  defineSandbox,
  defineWorkspace,
  withSandbox,
} from '@tanstack/ai-sandbox'
import { dockerSandbox } from '@tanstack/ai-sandbox-docker'

const sandbox = defineSandbox({
  id: 'repo-agent',
  provider: dockerSandbox({ image: 'node:22' }),
  workspace: defineWorkspace({
    source: { type: 'git', url: 'https://github.com/owner/repo', ref: 'main' },
    packageManager: 'pnpm',
    setup: ['corepack enable', 'pnpm install'],
    scripts: { test: 'pnpm test' },
    secrets: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? '' },
  }),
  lifecycle: { reuse: 'thread', snapshot: 'after-setup', keepAlive: '30m' },
})

const stream = chat({
  threadId,
  adapter: claudeCodeText('sonnet'),
  messages,
  middleware: [withSandbox(sandbox)],
})
```

## Type-safe secrets

```typescript
import { createSecrets, bearer } from '@tanstack/ai-sandbox'

const secrets = createSecrets({
  GH: process.env.GH_TOKEN ?? '',
  SENTRY: process.env.SENTRY_TOKEN ?? '',
})
// secrets.GH is a SecretRef — the underlying string is stored in a
// non-enumerable symbol-keyed registry and never logged, snapshotted,
// or written to the sandbox store.
```

Pass `secrets` to `defineWorkspace({ secrets })` so skill and MCP projectors
can resolve them. Use `secret: secrets.GH` in `gitSkill` for private-repo auth
and `secrets.GH` / `bearer(secrets.GH)` in MCP header values:

- `secrets.GH` — resolves to the raw token value.
- `bearer(secrets.GH)` — resolves to `"Bearer <value>"`.

## Declarative provisioning (skills, plugins, MCP, instructions)

```typescript
import {
  agentSkill,
  gitSkill,
  mcpSkill,
  fileSkill,
  bearer,
  createSecrets,
  defineWorkspace,
} from '@tanstack/ai-sandbox'

const secrets = createSecrets({ GH: process.env.GH_TOKEN ?? '' })

defineWorkspace({
  source: { type: 'git', url: 'https://github.com/owner/repo' },
  secrets,
  skills: [
    agentSkill('tanstack'), // named skill (no-op with warning on CLIs that lack the concept)
    gitSkill({
      repo: 'owner/private-skills',
      secret: secrets.GH, // resolved at bootstrap time, never stored
      // into: '/abs/path/inside/sandbox'  // optional; defaults to .tanstack-skills/<repo>
    }),
    mcpSkill('my-mcp', {
      url: 'https://mcp.example.com',
      headers: { Authorization: bearer(secrets.GH) },
    }),
    fileSkill({ path: '.hints.md', content: 'Prefer pnpm.' }),
  ],
  plugins: ['@anthropic/plugin-foo'], // no-op with warning on CLIs without a plugin concept
  instructions: 'Always run `pnpm test` before proposing a change.',
})
```

Each skill type is projected per harness (Claude Code → `.mcp.json`; Codex →
`.codex/config.toml`; OpenCode → `opencode.json`).
`instructions` is written as `AGENTS.md` at the workspace root; `CLAUDE.md` and
`GEMINI.md` are created as symlinks (falling back to copies on symlink failure).
Skills/plugins that a CLI lacks emit a `console.warn` and are skipped.

**`gitSkill` `into` field:** an **absolute path inside the sandbox** where the
repo is cloned. Defaults to `<root>/.tanstack-skills/<repo-basename>`.

## Fast init

### Shallow clone (`depth`)

`githubRepo` / `gitSource` default to `--depth 1 --single-branch`. Override:

```typescript
import { githubRepo, defineWorkspace } from '@tanstack/ai-sandbox'

defineWorkspace({ source: githubRepo({ repo: 'owner/app' }) }) // depth 1 (default)
defineWorkspace({ source: githubRepo({ repo: 'owner/app', depth: 10 }) }) // 10 commits
defineWorkspace({ source: githubRepo({ repo: 'owner/app', depth: 'full' }) }) // full history
```

### Serial / parallel `setup` callback

`setup` accepts a plain `Array<string>` (all serial) or a callback that records
serial and parallel groups over a **persistent shell** whose cwd/env carry over
between serial steps:

```typescript
defineWorkspace({
  source: githubRepo({ repo: 'owner/app' }),
  setup: ({ serial, parallel }) => {
    serial('corepack enable')
    serial('pnpm install')
    parallel(['pnpm build', 'pnpm typecheck']) // concurrent; inherit cwd+env from shell
    serial('echo done')
  },
})
```

### Snapshot-after-setup and `snapshotMaxAge`

When the provider supports snapshots, bootstrap takes one automatically after
`setup` completes. Subsequent runs resume from the snapshot (skipping setup).
Override or add a TTL:

```typescript
lifecycle: {
  snapshot: 'after-setup', // default when provider.capabilities().snapshots
  snapshotMaxAge: '24h',   // re-create when the snapshot is older than this
}
```

Providers without snapshot support skip the step silently.

## Providers

- `localProcessSandbox()` — runs on the host (no isolation; dev loop only).
- `dockerSandbox({ image })` — isolated container; snapshots, fork, resume-by-id.

Both implement the same `SandboxHandle`: `fs` (read/write/list/mkdir/remove/
rename/exists), `git` (clone/status/add/commit/push/pull/branch), `process`
(`exec` + duplex `spawn`), `ports.connect(port)`, `env.set`, optional
`snapshot()`/`fork()`, `destroy()`. Providers advertise support via
`capabilities()`; calling an unsupported optional method throws
`UnsupportedCapabilityError`.

## Policy

```typescript
import { defineSandboxPolicy } from '@tanstack/ai-sandbox'

const policy = defineSandboxPolicy({
  commands: {
    allow: ['pnpm test'],
    ask: ['curl *'],
    deny: ['sudo *', 'rm -rf *'],
  },
  capabilities: { fileWrite: 'allow', network: 'ask' },
  default: 'ask', // deny > ask > allow
})
// pass to defineSandbox({ policy }); harness adapters map it to native permissions
```

## Lifecycle &amp; resume

`reuse: 'thread'` resumes one sandbox per `threadId`; the compound key folds in
provider + workspace hash + tenant so changing the repo/setup/image starts
fresh. Ensure order: resume running → restore snapshot → create + bootstrap.

## Instance durability (durable resume)

Resume bookkeeping defaults to in-memory (single-process). For cross-process /
multi-replica resume, implement a durable `SandboxInstanceStore` (BYO) and pass
it as `withSandbox(sandbox, { instances })`. Pair multi-replica with a
distributed lock: either `withLocks` from `@tanstack/ai/locks` (ordered
**before** `withSandbox`) or the `locks` option.

```typescript
import { chat } from '@tanstack/ai'
import { InMemoryLockStore, withLocks } from '@tanstack/ai/locks'
import { withSandbox } from '@tanstack/ai-sandbox'
// Production: your BYO store — docs/sandbox/durability.md
import { instanceStore } from './sandbox-instance-store'

chat({
  adapter,
  messages,
  middleware: [
    withLocks(new InMemoryLockStore()), // multi-replica: distributed lock
    withSandbox(sandbox, { instances: instanceStore }),
  ],
})
```

The store option takes precedence over an ambient `SandboxInstanceStoreCapability`
(provided by a platform layer via `provideSandboxInstanceStore`), which in turn
beats the in-memory fallback.

Chat transcript durability (`withPersistence`) is independent — compose both
when the app needs history _and_ instance reuse. Prove adapters with
`runSandboxInstanceStoreConformance` from `@tanstack/ai-sandbox/testkit`.
Use `defineSandboxInstanceStore({ get, upsert, delete })` for inline typing of a
BYO store (same pattern as `defineLock` / `defineMessageStore`).

## File-event hooks

Watch the workspace for create/change/delete events. Provider-agnostic: native
`fs.watch` on local-process, a portable `find` poll on Docker/exec-only
providers (no extra deps or image changes).

Declare hooks on `defineSandbox({ hooks })` (sandbox-scoped) or on any chat
middleware via the `sandbox` group (run-scoped):

```typescript
import {
  defineSandbox,
  defineChatMiddleware,
  withSandbox,
} from '@tanstack/ai-sandbox'
import { dockerSandbox } from '@tanstack/ai-sandbox-docker'

// Sandbox-scoped hooks (all optional):
const sandbox = defineSandbox({
  id: 'repo-agent',
  provider: dockerSandbox({ image: 'node:22' }),
  hooks: {
    onFile: (e) => console.log(e.type, e.path), // catch-all
    onFileCreate: (e) => console.log('created', e.path),
    onFileChange: (e) => console.log('changed', e.path),
    onFileDelete: (e) => console.log('deleted', e.path),
    onReady: (handle) => console.log('ready', handle.id),
    onError: (err) => console.error(err),
    onDestroy: () => console.log('destroyed'),
  },
  fileEvents: true, // default; set false to disable watching entirely
})

// Run-scoped hooks via chat middleware (ctx is ChatMiddlewareContext):
const auditMiddleware = defineChatMiddleware({
  name: 'audit',
  sandbox: {
    onFile: (ctx, e) => console.log(ctx.runId, e.type, e.path),
    onFileCreate: (ctx, e) => db.log({ run: ctx.runId, event: e }),
    onFileChange: (ctx, e) => metrics.increment('file.change'),
    onFileDelete: (ctx, e) => console.warn('deleted', e.path),
  },
})

// No extra middleware needed — sandbox.file CUSTOM events are emitted
// automatically. Read them from the stream:
for await (const chunk of stream) {
  if (chunk.type === 'CUSTOM' && chunk.name === 'sandbox.file') {
    const value = chunk.value
    if (
      value !== null &&
      typeof value === 'object' &&
      'type' in value &&
      'path' in value
    ) {
      console.log('file event', value) // { type, path, timestamp }
    }
  }
}
```

`watchWorkspace()` is available as a low-level building block for watching
outside a `chat()` run:

```typescript
import { watchWorkspace } from '@tanstack/ai-sandbox'

const watcher = await watchWorkspace(handle, {
  onEvent: (e) => console.log(e.type, e.path),
  ignore: ['.git', 'node_modules'], // default
})
await watcher.stop()
```

Enable the `sandbox` debug category to log watcher start/stop, event dispatch,
and lifecycle transitions:

```typescript
chat({ threadId, adapter, messages, debug: { sandbox: true } })
// or debug: true to enable all categories
```

## Edge / serverless execution

A request-scoped Worker can't hold a multi-minute agent run open. The
serverless/edge model splits this: a **trigger** starts the run and returns
immediately, a **durable orchestrator** drives it, and clients **tail from a
resumable cursor**.

Core primitives (`@tanstack/ai-sandbox`, transport- and runtime-agnostic):

- **`pipeToRunLog` / `RunController`** (the run driver), built on two of core's
  (`@tanstack/ai`) durable seams: a `RunStore` for the run's lifecycle record
  (the same store `withPersistence` uses for chat history) and a
  `StreamDurability` for its event log (`memoryStream` or `durableStream`).
  `pipeToRunLog(stream, { runs, durability, runId, threadId, signal, logger })`
  pumps a `chat()` stream into both and is **total**: every store/event-log
  call is individually guarded, so it never throws and never rejects. A
  thrown stream error becomes a terminal `RUN_ERROR` event plus the record's
  `error`, so a detached client always observes failures, and a failing store
  write or a failing durability close is recorded through the optional
  `logger` (same `logger?.errors(...)` contract core uses) rather than
  silently absorbed. `threadId` is required. `RunController` wraps a fixed
  `RunDeps = { runs, durability, logger? }`:

  ```typescript
  import { RunController } from '@tanstack/ai-sandbox'
  import { memoryStream, InMemoryRunStore } from '@tanstack/ai'

  const controller = new RunController({
    runs: new InMemoryRunStore(),
    durability: memoryStream(request),
  })

  const handle = controller.start({ runId, threadId, stream })
  // handle.runId, handle.done (resolves with the terminal RunRecord)

  for await (const { offset, chunk } of controller.attach(fromOffset, signal)) {
    // fromOffset is an opaque string the durability adapter produced; for
    // memoryStream, '-1' replays from the start. `signal` is optional and
    // stops tailing when it aborts.
  }

  await controller.drain() // await every in-flight run, e.g. inside waitUntil
  ```

  Terminal statuses are `'completed' | 'failed' | 'aborted'` (core's
  `TerminalRunStatus`); a run may also be `'running'` or `'interrupted'`
  (`RunStatus`). A `RunController` instance is bound to one `deps.durability`
  and drives at most one run at a time: `start({ runId })` accepts an
  arbitrary `runId`, and nothing cross-checks it against the run the
  `durability` instance was constructed for, so passing a mismatched `runId`
  writes the lifecycle record under one id and the events under another,
  silently. Do not treat a single `RunController` as a multi-run manager.

- **Transport-agnostic tool-bridge** — `createToolBridgeCore` +
  `handleBridgeJsonRpc` are the portable core; `startHostToolBridge` is the
  `node:http` host transport. The `ToolBridgeProvisioner` capability injects the
  transport, so an edge orchestrator serves the same core from its own `fetch`
  handler (no raw TCP listener). Default = host transport.
- **Co-located host-tool seam** — `toolDescriptors` / `remoteToolStubs` /
  `httpRemoteToolExecutor` (container side) + `executeHostTool` (orchestrator
  side): only chat()-tool EXECUTION crosses the container→orchestrator boundary,
  not the whole MCP protocol.
- **`SandboxCapabilities.writableStdin`** — `false` for providers (e.g.
  Cloudflare) with no writable host→process stdin; stdin-fed harnesses then
  deliver the prompt via a file + in-shell redirection (`claude -p … < file`).

Cloudflare runtime (`@tanstack/ai-sandbox-cloudflare`):

- `createCloudflareSandboxAgent(config)` → `{ Coordinator, Sandbox, worker }` —
  an app's `worker.ts` is one configured call plus the wrangler-required DO
  re-exports. Two models via `mode`: `do-drives` (the DO runs `chat()`) and
  `colocated` (harness + bridge run in-container; the DO is a thin coordinator,
  pair with `runInContainerHarness` from `/runner`).
- `DurableObjectRunEventLog` mirrors `InMemoryRunEventLog` (both live in
  `@tanstack/ai-sandbox-cloudflare`, exported from its `/agent` entry) over DO
  storage; `timingSafeBearerEqualWeb` is the Web-Crypto constant-time bearer
  check. That package's own `RunStatus`, `TerminalRunStatus`, `RunRecord`, and
  `RunError` describe its event-log vocabulary, which is deliberately distinct
  from core's run-lifecycle types of the same names; the `/agent` entry
  re-exports them under a `Legacy` prefix (`LegacyRunStatus`,
  `LegacyTerminalRunStatus`, `LegacyRunRecord`, `LegacyRunError`) so an app can
  import both this package's run driver and the Cloudflare event log without a
  name collision. `RunEventLog`, `RunEvent`, and `RunEventLogReadOptions` have
  no equivalent in core and keep their plain names.

## Durable runs (the run journal)

A harness adapter's agent CLI (Claude Code, Codex, …) writes its NDJSON stdout
into a run journal instead of a pipe the host holds open: a shell redirect
appends every line to `/tmp/tanstack-runs/<runId>.ndjson` inside the sandbox
(stderr goes to a `<runId>.err` sidecar, never mixed in), so the host can
return without holding a live process handle, and a reader replays the same
file from byte 0 at any point, including after the original host has died.

```typescript
import { spawnNdjson } from '@tanstack/ai-sandbox'

for await (const event of spawnNdjson(sandbox, agentCommand, {
  cwd,
  journal: { runId }, // durability is opt-in: pass `journal` to route through it
})) {
  // parsed NDJSON objects, translated by the harness adapter as usual
}
```

**A `runId` MUST be unique per run.** The journal is append-only by design (a
takeover needs the prefix a previous host already wrote to still be there), so
reusing a `runId` appends to the previous run's journal file. A reader stops at
the FIRST `{"__exit":N}` sentinel it encounters, which is the earlier run's, so
the new run appears to emit nothing, or to fail with the previous run's exit
code. Every harness adapter (Claude Code, Codex, Grok Build, ACP, OpenCode)
does `options.runId ?? this.generateId()`, so a caller who wants durability
must supply its own stable `runId` per run; omitting it silently falls back to
a fresh random id each call, and no successor host can derive that run's
journal path. This is the easiest way to lose the feature without any error
being raised.

### Reading strategy

`readJournal` (and `spawnNdjson`'s journal path, via `readJournalNdjson`)
picks one of two strategies from the sandbox's advertised capabilities, never
from the provider's name:

- **follow** (`tail -f`, started with `handle.process.spawn`), when
  `capabilities.backgroundProcesses && capabilities.killableProcesses` are
  both true. It streams with no polling cost and is stopped by killing the
  `tail` when the consumer stops reading.
- **bounded poll** (repeated bounded `exec` reads, `DEFAULT_JOURNAL_POLL_MS`,
  250ms) otherwise. `killableProcesses` is `false` for a provider like
  Cloudflare, whose `kill()` is a documented no-op and whose Workers RPC
  cannot serialize an `AbortSignal` across the boundary, so a `tail -f`
  started there could never be stopped and the poll path is used instead.

The bounded read (`journalReadCommand`) base64-frames its output, because
`exec` closes the encoder's stdin, which flushes it, so the whole frame
arrives as one complete result. The follow path (`journalFollowCommand`) does
**not** base64-frame its output: `base64` fully buffers its stdout when that
stdout is not a tty, so `tail -f file | base64` would emit nothing until the
libc stdio buffer fills or `tail -f`'s stdin closes, and that stdin never
closes until the reader kills it, at which point the consumer has already
stopped waiting for bytes. Dropping the frame on the follow path is safe
because the journal is line-delimited JSON and every provider already decodes
stdout text on this path the same way it decodes an agent's own stdout.

### Alignment: replaying without duplicating

`alignToStoredLog` reads a run's already-stored event log with
`durability.snapshot()` (a bounded, point-in-time read; never `read()`, which
tails and never resolves against a log a dead producer never closed),
compares each replayed chunk against the stored one by `chunkFingerprint`, and
forwards only the remainder past what is already stored. Downstream, that
remainder is always passed to `append`, never `upsert`: the journal path only
ever appends, because deciding the append point is exactly what alignment
does. A replayed chunk that does not match the stored chunk at the same index
throws `JournalReplayDivergedError` rather than forwarding data that might be
corrupt.

Message ids on the journaled path come from `createRunScopedIdGen(runId)`,
a per-run counter (`<runId>-0`, `<runId>-1`, …) with no clock and no
randomness, wired as harness translators' `genId`, so re-translating the same
journal bytes twice reproduces the same ids. `chunkFingerprint` excludes only
the `timestamp` field (wall-clock, unreproducible) from the comparison;
everything else, including nested tool-call arguments, participates.

**Determinism is translator-level only.** On `ai-claude-code` and `ai-codex`,
`mergeChunkStreams(translated, channel.stream)` splices host-tool-bridge
events from a live tool execution into the middle of the stream; those events
do not occur again on replay. A run that used a bridged tool can still
diverge on replay for that reason: alignment guarantees reproducibility of
the translation step, not of everything that can happen during a run.

### Cleanup

Once a run reaches its `{"__exit":N}` sentinel, both journal files are
deleted. A run that terminates while **detached** (no host reading its
journal) has no reader to observe the sentinel, so nothing deletes its
journal; it leaks until the sandbox itself is destroyed. Bounding that is
future reaper work, not something this journal, reader, or alignment
primitive provides today.

Detach, takeover, and reconnection are not implemented by any of the pieces
above. The journal, the reader, and `alignToStoredLog` are the primitives a
takeover would be built from; nothing today drives one.

## Events

- `claude-code.session-id` (CUSTOM) — resumable session id → pass back via
  `modelOptions.sessionId`.
- `file.changed` (CUSTOM) — `{ path, diff }` working-tree diff after the run.
- `sandbox.file` (CUSTOM) — `{ type, path, timestamp }` per file create/change/
  delete, emitted automatically when a sandbox is active.

## Critical rules

- **Harness adapters require a sandbox.** Always include `withSandbox(...)` in
  `middleware` — without it `chat()` throws a missing-capability error.
- **Secrets** (`workspace.secrets`) are injected into the sandbox env and never
  persisted (no snapshots, no sandbox store, no event log). Always create them
  with `createSecrets(...)` so the values stay hidden behind `SecretRef` tokens.
  The agent binary (`claude`) must exist in the sandbox image (install it in
  `setup` or bake it into the image).
- **Secret-bearing projected files** (e.g. MCP config with resolved header
  values) are re-written on every projection call so rotated secrets re-apply;
  they are never included in a snapshot.
- **chat()-provided `tools` are bridged** into the in-sandbox agent over a
  host-side MCP tool-proxy: the agent calls them as `mcp__tanstack__<tool>` and
  each call is proxied back to the host where the tool's `execute()` runs (with
  its closures / DB / secrets). The agent also has its own native tools
  (Bash/Edit/Read/…). The host bridge binds on the host; the sandbox reaches it
  (localhost, or `host.docker.internal` for Docker), gated by a per-run bearer
  token.
- Use `localProcessSandbox()` only in trusted/dev contexts (no isolation).
- Skills/plugins that a CLI lacks (e.g. `agentSkill` on Codex, `plugins` on
  Codex) warn and skip — they do not throw.
