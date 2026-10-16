import { describe, expect, test } from 'bun:test'
import {
  formatAccelerator,
  fuzzyScore,
  highlightIndices,
  highlightRuns,
  matchFields,
  parsePaletteQuery,
  parseRecent,
  rankPalette,
  recordRecent,
  type PaletteCommand,
  type PalettePlace
} from './command-palette'
import { parseLocations, recordLocation } from './recent-locations'

const commands: PaletteCommand[] = [
  { id: 'new-connection', title: 'New Connection…', section: 'Connections', keywords: ['attach', 'add', 'account'] },
  { id: 'upload-files', title: 'Upload Files…', section: 'Blobs' },
  { id: 'new-folder', title: 'New Folder…', section: 'Blobs', keywords: ['directory', 'mkdir'] },
  { id: 'copy-secret', title: 'Copy Connection Secret', section: 'Connections', keywords: ['sas', 'connection string'] },
  { id: 'toggle-sidebar', title: 'Toggle Sidebar', section: 'View', accelerator: 'CmdOrCtrl+B' },
  { id: 'download', title: 'Download Selected', section: 'Blobs', enabled: false }
]
const places: PalettePlace[] = [
  { id: 'conn:prod', kind: 'connection', title: 'Prod storage', subtitle: 'prodstore.blob.core.windows.net' },
  { id: 'ctr:prod/logs', kind: 'container', title: 'logs', subtitle: 'Prod storage' },
  { id: 'ctr:prod/backups', kind: 'container', title: 'backups', subtitle: 'Prod storage' },
  { id: 'path:prod/logs/2026/10', kind: 'path', title: '2026/10/', subtitle: 'logs · Prod storage' }
]
const rank = (input: string, mode: 'all' | 'places' | 'commands' = 'all', recent: string[] = []) =>
  rankPalette({ input, mode, commands, places, recent, platform: 'darwin' })

describe('fuzzy matching', () => {
  test('prefix beats word start beats anywhere; non-subsequence is null', () => {
    const prefix = fuzzyScore('tog', 'Toggle Sidebar')!
    const word = fuzzyScore('side', 'Toggle Sidebar')!
    const inner = fuzzyScore('gle', 'Toggle Sidebar')!
    expect(prefix).toBeGreaterThan(word)
    expect(word).toBeGreaterThan(inner)
    expect(fuzzyScore('xyz', 'Toggle Sidebar')).toBeNull()
    expect(fuzzyScore('tsb', 'Toggle Sidebar')).not.toBeNull()
  })
  test('every term must match some field', () => {
    expect(matchFields('copy sas', ['Copy Connection Secret', 'sas'])).not.toBeNull()
    expect(matchFields('copy zzz', ['Copy Connection Secret', 'sas'])).toBeNull()
  })
})

describe('highlight', () => {
  test('contiguous hit highlights the run, otherwise the subsequence', () => {
    expect(highlightIndices('fold', 'New Folder…')).toEqual([4, 5, 6, 7])
    expect(highlightIndices('nf', 'New Folder…')).toEqual([0, 4])
    expect(highlightIndices('zz', 'New Folder…')).toEqual([])
    expect(highlightIndices('new fold', 'New Folder…')).toEqual([0, 1, 2, 4, 5, 6, 7])
  })
  test('runs split plain and hit text', () => {
    expect(highlightRuns('logs', [0, 1])).toEqual([
      { text: 'lo', hit: true },
      { text: 'gs', hit: false }
    ])
    expect(highlightRuns('', [])).toEqual([])
  })
})

describe('accelerators', () => {
  test('mac symbols and other platforms', () => {
    expect(formatAccelerator('CmdOrCtrl+Shift+M', 'darwin')).toBe('⇧⌘M')
    expect(formatAccelerator('CmdOrCtrl+Shift+M', 'linux')).toBe('Ctrl+Shift+M')
    expect(formatAccelerator('CmdOrCtrl+,', 'darwin')).toBe('⌘,')
    expect(formatAccelerator(null, 'darwin')).toBeNull()
  })
})

describe('recents', () => {
  test('most recent first, deduped, capped', () => {
    expect(recordRecent(['cmd:a', 'place:b'], 'place:b')).toEqual(['place:b', 'cmd:a'])
    expect(parseRecent(['x', 'x', 3, '', 'y'])).toEqual(['x', 'y'])
    expect(parseRecent('nope')).toEqual([])
  })
  test('recent folders: dedupe, skip container roots, trim slashes, validate', () => {
    let list = recordLocation([], { accountId: 'a', container: 'logs', prefix: '2026/10/' })
    list = recordLocation(list, { accountId: 'a', container: 'logs', prefix: '' })
    list = recordLocation(list, { accountId: 'a', container: 'logs', prefix: 'x' })
    list = recordLocation(list, { accountId: 'a', container: 'logs', prefix: '/2026/10' })
    expect(list).toEqual([
      { accountId: 'a', container: 'logs', prefix: '2026/10' },
      { accountId: 'a', container: 'logs', prefix: 'x' }
    ])
    expect(parseLocations([...list, { accountId: 'a' }, null, 'x', list[0]])).toEqual(list)
    expect(parseLocations({})).toEqual([])
  })
})

describe('rankPalette', () => {
  test('> forces commands only, @ places only', () => {
    expect(parsePaletteQuery('> tog', 'all')).toEqual({ query: 'tog', mode: 'commands' })
    expect(parsePaletteQuery('@logs', 'all')).toEqual({ query: 'logs', mode: 'places' })
    expect(rank('>').every((i) => i.kind === 'command')).toBe(true)
    expect(rank('>').length).toBe(5)
    expect(rank('@').every((i) => i.kind === 'place')).toBe(true)
  })
  test('empty query shows recent commands, then places with recents first', () => {
    const items = rank('', 'all', ['place:ctr:prod/backups', 'cmd:new-folder'])
    expect(items[0]).toMatchObject({ kind: 'command', commandId: 'new-folder' })
    expect(items.filter((i) => i.kind === 'place').map((i) => i.key)).toEqual([
      'place:ctr:prod/backups',
      'place:conn:prod',
      'place:ctr:prod/logs',
      'place:path:prod/logs/2026/10'
    ])
  })
  test('places mode never lists commands', () => {
    expect(rank('new', 'places').some((i) => i.kind === 'command')).toBe(false)
  })
  test('finds containers, connections and folders', () => {
    expect(rank('back')[0]).toMatchObject({ kind: 'place', placeId: 'ctr:prod/backups', hits: [0, 1, 2, 3] })
    expect(rank('prod')[0]).toMatchObject({ kind: 'place', placeKind: 'connection' })
    expect(rank('logs 2026')[0]).toMatchObject({ placeKind: 'path' })
  })
  test('finds commands by keyword, shows the shortcut, hides disabled commands', () => {
    expect(rank('sas')[0]).toMatchObject({ kind: 'command', commandId: 'copy-secret' })
    expect(rank('mkdir')[0]).toMatchObject({ commandId: 'new-folder' })
    expect(rank('sidebar')[0]).toMatchObject({ commandId: 'toggle-sidebar', shortcut: '⌘B' })
    expect(rank('download').some((i) => i.kind === 'command')).toBe(false)
  })
  test('a title hit beats a recent keyword-only hit', () => {
    const cmds: PaletteCommand[] = [
      { id: 'transfers', title: 'Toggle Transfers Panel', section: 'View', keywords: ['uploads'] },
      { id: 'upload', title: 'Upload Files…', section: 'Explorer' }
    ]
    const items = rankPalette({ input: 'upl', mode: 'all', commands: cmds, places: [], recent: ['cmd:transfers'], platform: 'darwin' })
    expect(items[0]).toMatchObject({ commandId: 'upload' })
  })
  test('recent picks get a boost', () => {
    const plain = rank('o').map((i) => i.key)
    const boosted = rank('o', 'all', ['place:ctr:prod/logs']).map((i) => i.key)
    expect(boosted.indexOf('place:ctr:prod/logs')).toBeLessThanOrEqual(plain.indexOf('place:ctr:prod/logs'))
    expect(boosted[0]).toBe('place:ctr:prod/logs')
  })
})
