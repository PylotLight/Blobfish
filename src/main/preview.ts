import { decryptSecret } from './accounts'
import {
  blobContainerClientFromSecret,
  dataLakeFileSystemClientFromSecret,
  friendlyError,
  isDfsEndpoint
} from './azure'
import {
  PREVIEW_DEFAULT_BYTES,
  PREVIEW_DEFAULT_LINES,
  PREVIEW_MAX_BYTES,
  PREVIEW_MAX_LINES,
  PREVIEW_MIN_BYTES,
  looksBinary,
  looksTexty,
  sliceTextChunk,
  suggestFlavor
} from '../shared/preview'
import type { PreviewArgs, PreviewResult } from '../shared/types'

const clampInt = (v: number, lo: number, hi: number, fallback: number): number => {
  if (!Number.isFinite(v)) return fallback
  return Math.min(hi, Math.max(lo, Math.floor(v)))
}

async function streamToBuffer(stream: NodeJS.ReadableStream | undefined): Promise<Buffer> {
  if (!stream) return Buffer.alloc(0)
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

/**
 * Efficient blob preview: one HTTP range GET per page, never the whole blob.
 * The chunk is cut back to a line boundary so pages join cleanly, and UTF-8
 * tails are never split — safe to page through multi-GiB CSVs and logs.
 */
export async function previewBlob(args: PreviewArgs): Promise<PreviewResult> {
  const container = (args.container ?? '').trim()
  const name = (args.name ?? '').trim()
  if (container === '' || name === '') throw new Error('No file selected for preview.')
  const offset = clampInt(args.offset ?? 0, 0, Number.MAX_SAFE_INTEGER, 0)
  const maxBytes = clampInt(args.maxBytes ?? PREVIEW_DEFAULT_BYTES, PREVIEW_MIN_BYTES, PREVIEW_MAX_BYTES, PREVIEW_DEFAULT_BYTES)
  const maxLines = clampInt(args.maxLines ?? PREVIEW_DEFAULT_LINES, 1, PREVIEW_MAX_LINES, PREVIEW_DEFAULT_LINES)

  const base = { name, offset, nextOffset: offset, eof: true, encoding: 'utf-8' }

  try {
    const { profile, secret } = decryptSecret(args.accountId)
    const dfs = isDfsEndpoint(profile.endpoint)

    let size = 0
    let contentType: string | undefined
    if (dfs) {
      const file = dataLakeFileSystemClientFromSecret(secret, container).getFileClient(name)
      const props = await file.getProperties()
      size = props.contentLength ?? 0
      contentType = (props as { contentType?: string }).contentType ?? undefined
      if (offset >= size) {
        return { ...base, size, contentType, flavor: suggestFlavor(name, contentType), binary: false, text: '', bytesFetched: 0, cutMidLine: false }
      }
      const count = Math.min(maxBytes, size - offset)
      const res = await file.read(offset, count)
      const buf = await streamToBuffer(res.readableStreamBody as NodeJS.ReadableStream | undefined)
      return buildChunk(base, buf, { size, contentType, name, offset, maxLines })
    }

    const blob = blobContainerClientFromSecret(secret, container).getBlobClient(name)
    const props = await blob.getProperties()
    size = props.contentLength ?? 0
    contentType = props.contentType
    if (offset >= size) {
      return { ...base, size, contentType, flavor: suggestFlavor(name, contentType), binary: false, text: '', bytesFetched: 0, cutMidLine: false }
    }
    const count = Math.min(maxBytes, size - offset)
    const res = await blob.download(offset, count)
    const buf = await streamToBuffer(res.readableStreamBody)
    return buildChunk(base, buf, { size, contentType, name, offset, maxLines })
  } catch (err) {
    throw friendlyError(err, `Failed to preview "${name.split('/').pop() ?? name}"`)
  }
}

function buildChunk(
  base: { name: string; offset: number; nextOffset: number; eof: boolean; encoding: string },
  buf: Buffer,
  ctx: { size: number; contentType?: string; name: string; offset: number; maxLines: number }
): PreviewResult {
  const flavor = suggestFlavor(ctx.name, ctx.contentType)
  if (buf.length === 0) {
    return { ...base, size: ctx.size, contentType: ctx.contentType, flavor, binary: false, text: '', bytesFetched: 0, cutMidLine: false }
  }
  if (looksBinary(buf)) {
    // Binary blobs get metadata only — no wasted decoding, no garbled output.
    // `nextOffset` stays at the requested offset; text previews never page.
    return {
      ...base,
      size: ctx.size,
      contentType: ctx.contentType,
      flavor,
      binary: true,
      text: '',
      bytesFetched: buf.length,
      cutMidLine: false
    }
  }

  // Unknown-text fallback: if the extension isn't a known text type and the
  // server doesn't claim text, only the sniff above vouches for it — still
  // show it, flagged by `guessed`.
  const guessed = !looksTexty(ctx.name, ctx.contentType)
  const slice = sliceTextChunk(buf, ctx.size, ctx.offset, ctx.maxLines)
  return {
    ...base,
    size: ctx.size,
    contentType: ctx.contentType,
    flavor,
    binary: false,
    guessed,
    text: slice.text,
    bytesFetched: slice.bytesFetched,
    nextOffset: slice.nextOffset,
    eof: slice.eof,
    cutMidLine: slice.cutMidLine
  }
}
