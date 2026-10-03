/**
 * Pure preview helpers — no Electron imports, safe from main, renderer, and
 * tests. Main owns byte-range fetching (`src/main/preview.ts`); everything
 * that interprets bytes lives here so it stays unit-testable.
 */

/** First paint fetches at most this much per range GET. */
export const PREVIEW_DEFAULT_BYTES = 256 * 1024
export const PREVIEW_MIN_BYTES = 4 * 1024
export const PREVIEW_MAX_BYTES = 1024 * 1024

/** First paint parses at most this many lines; paging raises it chunk by chunk. */
export const PREVIEW_DEFAULT_LINES = 300
export const PREVIEW_MAX_LINES = 2000

/**
 * Client-side cap on accumulated preview text. Keeps the DOM light when a
 * user pages deep into a 2 GiB file — the full blob is never downloaded,
 * only range GETs, and rendering stops here with a notice.
 */
export const PREVIEW_CLIENT_CAP = 2 * 1024 * 1024

/** Paged rendering cap so a huge accumulation can't freeze the table. */
export const PREVIEW_RENDER_LINES = 2000

export type PreviewFlavor = 'csv' | 'text'

const CSV_EXTS = new Set(['csv', 'tsv', 'tab'])

const TEXT_EXTS = new Set([
  'txt', 'text', 'md', 'markdown', 'mdown', 'log', 'json', 'jsonl', 'ndjson',
  'xml', 'xsl', 'xsd', 'svg', 'yml', 'yaml', 'toml', 'ini', 'cfg', 'conf',
  'env', 'properties', 'csv', 'tsv', 'tab', 'psv', 'sql', 'sh', 'bash', 'zsh',
  'ps1', 'py', 'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'mts', 'cts', 'css',
  'scss', 'less', 'html', 'htm', 'vue', 'svelte', 'java', 'kt', 'kts', 'c',
  'h', 'cpp', 'hpp', 'cc', 'cs', 'go', 'rs', 'rb', 'php', 'pl', 'pm', 'lua',
  'scala', 'hs', 'ex', 'exs', 'erl', 'r', 'jl', 'graphql', 'gql', 'proto',
  'tf', 'tfvars', 'dockerfile', 'makefile', 'gradle', 'pom', 'lock', 'diff',
  'patch', 'tsv', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc',
  'eslintrc', 'prettierrc', 'babelrc'
])

export function extOf(name: string): string {
  const base = name.split('/').pop() ?? name
  const lower = base.toLowerCase()
  if (lower === 'dockerfile' || lower === 'makefile') return lower
  const dot = base.lastIndexOf('.')
  if (dot === 0) return base.length > 1 ? base.slice(1).toLowerCase() : ''
  if (dot < 0 || dot === base.length - 1) return ''
  return base.slice(dot + 1).toLowerCase()
}

/** Table view for csv/tsv; everything else renders as monospaced text. */
export function suggestFlavor(name: string, contentType?: string): PreviewFlavor {
  const ext = extOf(name)
  if (CSV_EXTS.has(ext)) return 'csv'
  const ct = (contentType ?? '').toLowerCase()
  if (ct.includes('text/csv') || ct.includes('tab-separated')) return 'csv'
  return 'text'
}

/** Known-text extension or text-ish content type — worth trying as text. */
export function looksTexty(name: string, contentType?: string): boolean {
  if (TEXT_EXTS.has(extOf(name))) return true
  const ct = (contentType ?? '').toLowerCase()
  return (
    ct.startsWith('text/') ||
    ct.includes('json') ||
    ct.includes('xml') ||
    ct.includes('csv') ||
    ct.includes('yaml') ||
    ct === 'application/javascript' ||
    ct === 'application/x-sh'
  )
}

/**
 * Binary sniff over the fetched sample: a NUL byte means binary.
 * UTF-8/ASCII text (incl. UTF-16 without NULs in the sampled range is rare)
 * never contains 0x00, so this is cheap and reliable for the common cases.
 */
export function looksBinary(sample: Uint8Array, maxScan = 8192): boolean {
  const n = Math.min(sample.length, maxScan)
  for (let i = 0; i < n; i++) {
    if (sample[i] === 0) return true
  }
  return false
}

/**
 * End offset (exclusive) of the last complete UTF-8 character at or before
 * `buf.length`. A range GET can split a multi-byte sequence (even on its lead
 * byte); decoding past the split would emit U+FFFD and shift the next page's
 * byte offset.
 */
export function utf8SafeEnd(buf: Uint8Array): number {
  const end = buf.length
  if (end === 0) return 0
  // Index of the first byte of the final character.
  let i = end - 1
  while (i > 0 && (buf[i]! & 0xc0) === 0x80) i -= 1
  const lead = buf[i]!
  const need = lead >= 0xf0 ? 4 : lead >= 0xe0 ? 3 : lead >= 0xc0 ? 2 : 1
  return end - i < need ? i : end
}

/** Byte index of the last `\n` strictly before `limit`, or -1. */
export function lastNewlineBefore(buf: Uint8Array, limit: number): number {
  const end = Math.min(limit, buf.length)
  for (let i = end - 1; i >= 0; i--) {
    if (buf[i] === 0x0a) return i
  }
  return -1
}

/** Byte index of the Nth `\n` (1-based), or -1 when fewer exist. */
export function nthNewline(buf: Uint8Array, n: number, limit: number): number {
  const end = Math.min(limit, buf.length)
  let seen = 0
  for (let i = 0; i < end; i++) {
    if (buf[i] === 0x0a) {
      seen += 1
      if (seen === n) return i
    }
  }
  return -1
}

export interface ChunkSlice {
  text: string
  nextOffset: number
  eof: boolean
  cutMidLine: boolean
  bytesFetched: number
}

/**
 * Pure core of main-side paging: given the raw bytes of one range GET
 * (`buf`, fetched at `offset` from a `size`-byte blob), cut back to a clean
 * line boundary and decode. Pages join byte-exactly: concatenating every
 * page's text reproduces the file prefix (lossless except a split UTF-8 tail,
 * which is deferred to the next page).
 */
export function sliceTextChunk(
  buf: Uint8Array,
  size: number,
  offset: number,
  maxLines: number
): ChunkSlice {
  const fetchedToEnd = offset + buf.length >= size
  // Never decode a split multi-byte sequence at the tail.
  const safeLen = Math.min(buf.length, utf8SafeEnd(buf))
  let cut = safeLen
  let cutMidLine = false

  if (!fetchedToEnd) {
    const lineCapAt = nthNewline(buf, maxLines, safeLen)
    if (lineCapAt !== -1) {
      cut = lineCapAt + 1 // honour the per-page line budget
    } else {
      const last = lastNewlineBefore(buf, safeLen)
      if (last !== -1) {
        cut = last + 1 // leave the partial trailing line for the next page
      } else {
        // Single line longer than the chunk (e.g. minified JSON): emit the
        // whole chunk and continue mid-line next page.
        cutMidLine = true
      }
    }
  }

  const text = new TextDecoder('utf-8').decode(buf.slice(0, cut))
  const nextOffset = offset + cut
  return { text, nextOffset, eof: nextOffset >= size, cutMidLine, bytesFetched: cut }
}

/* ---------------- CSV ---------------- */

const DELIMITER_CANDIDATES = [',', '\t', ';', '|'] as const

/** Pick the delimiter with the most consistent non-zero counts across lines. */
export function detectDelimiter(lines: string[]): string {
  let best = ','
  let bestScore = 0
  for (const d of DELIMITER_CANDIDATES) {
    let total = 0
    let hits = 0
    for (const line of lines.slice(0, 5)) {
      if (line.trim() === '') continue
      const c = countOutsideQuotes(line, d)
      total += c
      if (c > 0) hits += 1
    }
    const score = hits === 0 ? 0 : total * hits
    if (score > bestScore) {
      bestScore = score
      best = d
    }
  }
  return best
}

function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') i += 1 // escaped quote
      else inQuotes = !inQuotes
    } else if (ch === delimiter && !inQuotes) {
      count += 1
    }
  }
  return count
}

export interface ParsedCsv {
  rows: string[][]
  /** False when the text ends mid-row (no closing newline / unbalanced quotes). */
  complete: boolean
}

/**
 * RFC-4180-ish parse: quoted fields may contain delimiters, escaped `""`
 * quotes, and embedded newlines. Tolerates ragged rows (short rows are
 * padded at render time).
 */
export function parseCsv(text: string, delimiter: string): ParsedCsv {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  const pushField = (): void => {
    row.push(field)
    field = ''
  }
  const pushRow = (): void => {
    pushField()
    // Skip the phantom row from a trailing newline — callers treat EOF text
    // ending in `\n` as complete without displaying an empty row.
    if (!(row.length === 1 && row[0] === '' && rows.length > 0)) rows.push(row)
    row = []
  }
  while (i < text.length) {
    const ch = text[i]!
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
        } else {
          inQuotes = false
          i += 1
        }
      } else {
        field += ch
        i += 1
      }
    } else if (ch === '"') {
      inQuotes = true
      i += 1
    } else if (ch === delimiter) {
      pushField()
      i += 1
    } else if (ch === '\r' && text[i + 1] === '\n') {
      pushRow()
      i += 2
    } else if (ch === '\n' || ch === '\r') {
      pushRow()
      i += 1
    } else {
      field += ch
      i += 1
    }
  }
  const complete = !inQuotes && (row.length === 0 || (row.length === 1 && row[0] === '' && field === ''))
  if (!complete) {
    pushField()
    rows.push(row)
  }
  return { rows, complete }
}

/**
 * Rows safe to display from the accumulation so far. When more bytes remain
 * server-side (`!eof`) the trailing row may be a partial chunk cut, so it is
 * held back as pending until the next page arrives.
 */
export function displayableCsvRows(
  parsed: ParsedCsv,
  eof: boolean
): { rows: string[][]; pending: boolean } {
  if (eof || parsed.complete) return { rows: parsed.rows, pending: false }
  if (parsed.rows.length === 0) return { rows: [], pending: true }
  return { rows: parsed.rows.slice(0, -1), pending: true }
}
