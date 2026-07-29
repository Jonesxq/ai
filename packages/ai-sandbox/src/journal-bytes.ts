/**
 * Byte-exact framing for journal reads.
 *
 * The journal is read through `base64` (see `journal.ts` rule 2), so the host
 * receives an ASCII frame it decodes itself. That gives two properties nothing
 * else on the provider surface offers: the bytes are exactly the file's bytes
 * regardless of how a provider decoded its stdout, and a position counted over
 * them is a real file offset that `tail -c +N` can resume from.
 *
 * `atob`, not `Buffer`: this module runs on the host, and the host can itself be
 * a Cloudflare Worker (`ai-sandbox-cloudflare` drives its sandbox over Workers
 * RPC from Worker code), where `Buffer` is not a global unless the `nodejs_compat`
 * flag is on. `atob` is a Web/DOM API available in every host runtime this
 * package targets, so it is the portable choice here.
 */

const NEWLINE = 0x0a

/** Decode one complete base64 quantum group to bytes. */
function decodeQuantumGroup(group: string): Uint8Array {
  const binary = atob(group)
  const out = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    out[index] = binary.charCodeAt(index)
  }
  return out
}

/**
 * Decode a streaming base64 frame into raw bytes.
 *
 * Whitespace is stripped because `base64(1)` wraps at 76 columns by default and
 * busybox's build does not accept `-w 0`, so the wrapping cannot be turned off
 * portably. Only complete 4-character quanta are decoded; a remainder is held
 * for the next chunk. Padding (`=`) appears only in the final quantum, so an
 * intermediate group always decodes to exactly 3 bytes.
 */
export async function* decodeBase64Stream(
  chunks: AsyncIterable<string>,
): AsyncIterable<Uint8Array> {
  let pending = ''
  for await (const chunk of chunks) {
    pending += chunk.replace(/\s+/g, '')
    const usable = pending.length - (pending.length % 4)
    if (usable === 0) continue
    const group = pending.slice(0, usable)
    pending = pending.slice(usable)
    yield decodeQuantumGroup(group)
  }
  if (pending.length > 0) {
    // Fail loud. A remainder means the frame was cut off mid-quantum, i.e. the
    // reader died partway through. Rounding it away would silently drop journal
    // bytes and desync every position derived from this stream.
    throw new Error(
      `journal: base64 frame ended mid-quantum with ${pending.length} character(s) pending`,
    )
  }
}

/** One complete journal line plus the absolute byte position just past its newline. */
export interface JournalLine {
  /** The line's text, newline excluded. */
  line: string
  /**
   * Absolute byte offset immediately AFTER this line's newline — i.e. the count
   * of journal bytes fully consumed once this line has been handled, and
   * therefore the exact value to resume a `tail -c +N` from.
   */
  endPosition: number
}

function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  const out = new Uint8Array(left.length + right.length)
  out.set(left, 0)
  out.set(right, left.length)
  return out
}

/**
 * Split a byte stream into newline-terminated lines, tracking absolute
 * positions from `startPosition`.
 *
 * Deliberately unlike `toLines` in `runner.ts`, which yields a trailing
 * unterminated line: here a trailing partial line is a line the agent is still
 * writing. Yielding it would hand a truncated JSON string downstream AND
 * advance the position past bytes the next read must re-see.
 */
export async function* toJournalLines(
  byteChunks: AsyncIterable<Uint8Array>,
  startPosition: number,
): AsyncIterable<JournalLine> {
  const decoder = new TextDecoder()
  let buffer: Uint8Array = new Uint8Array(0)
  let position = startPosition
  for await (const bytes of byteChunks) {
    buffer = concatBytes(buffer, bytes)
    let newline = buffer.indexOf(NEWLINE)
    while (newline !== -1) {
      const lineBytes = buffer.subarray(0, newline)
      position += newline + 1
      yield { line: decoder.decode(lineBytes), endPosition: position }
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf(NEWLINE)
    }
  }
}
