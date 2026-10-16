import { describe, expect, mock, test } from 'bun:test'

// Drives the real transfer queue with electron + azure stubbed out.
const sent: Array<{ transfers: unknown[] }> = []
const uploadOpts: Array<Record<string, unknown>> = []
const N = 400
let streaming = false

mock.module('electron', () => ({
  dialog: {
    showOpenDialog: async (_w: unknown, o: { properties: string[] }) => ({
      canceled: false,
      filePaths: o.properties.includes('openDirectory') ? ['/tmp/blobfish-test-dl'] : [import.meta.path]
    })
  }
}))
mock.module('./window', () => ({
  getMainWindow: () => ({ webContents: { send: (_ch: string, snap: { transfers: unknown[] }) => sent.push(snap) } })
}))
mock.module('./activity', () => ({ logActivity: () => {} }))
mock.module('./accounts', () => ({
  decryptSecret: () => ({ profile: { name: 'acc', endpoint: 'https://acc.blob.core.windows.net' }, secret: {} })
}))
mock.module('./azure', () => ({
  isDfsEndpoint: () => false,
  friendlyError: (e: unknown) => e,
  dataLakeFileSystemClientFromSecret: () => ({}),
  blobContainerClientFromSecret: () => ({
    async *listBlobsFlat() {
      for (let i = 0; i < N; i++) yield { name: `logs/part-${i}.json`, properties: { contentLength: 10 } }
    },
    getBlobClient: () => ({
      getProperties: async () => ({ contentLength: streaming ? 2 ** 40 : 10 }),
      downloadToFile: async (_p: string, _o: number, _c: unknown, o: { onProgress: (e: { loadedBytes: number }) => void }) => {
        if (!streaming) return new Promise((r) => setTimeout(r, 1))
        // ~64 KiB per callback like the SDK, 16 per ms ≈ 1 GiB/s for 400ms.
        let loaded = 0
        const end = Date.now() + 400
        while (Date.now() < end) {
          for (let i = 0; i < 16; i++) o.onProgress({ loadedBytes: (loaded += 65536) })
          await new Promise((r) => setTimeout(r, 1))
        }
      }
    }),
    getBlockBlobClient: () => ({
      uploadFile: async (_p: string, o: Record<string, unknown>) => {
        uploadOpts.push(o)
      }
    })
  })
}))

const settle = async (tr: typeof import('./transfers')): Promise<void> => {
  for (let i = 0; i < 2000 && tr.snapshot().active + tr.snapshot().queued > 0; i++) {
    await new Promise((r) => setTimeout(r, 5))
  }
  await new Promise((r) => setTimeout(r, 300))
}

describe('transfer queue', () => {
  test('a big folder download coalesces snapshots instead of one per row', async () => {
    const tr = await import('./transfers')
    const ids = await tr.enqueueDownload('a', 'c', ['logs/'])
    expect(ids.length).toBe(N)
    // Was N sends on enqueue alone (+2 per row as each started/finished): O(n²) bytes.
    expect(sent.length).toBe(0)
    await settle(tr)
    expect(tr.snapshot().transfers.length).toBe(0)
    expect(sent.length).toBeLessThan(40)
    expect(sent.at(-1)?.transfers.length).toBe(0)
  })

  test('speed is measured over the tick window, not the last 64 KiB callback', async () => {
    const tr = await import('./transfers')
    streaming = true
    await tr.enqueueDownload('a', 'c', ['big.bin'])
    await new Promise((r) => setTimeout(r, 300))
    const speed = tr.snapshot().transfers[0]?.speedBps ?? 0
    await settle(tr)
    streaming = false
    // Real rate is ~1 GiB/s (timer-bound, so allow lots of slack); the old math reported ~1 MiB/s.
    expect(speed).toBeGreaterThan(50 * 1024 * 1024)
  })

  test('uploads stripe across block connections above the single-shot size', async () => {
    const tr = await import('./transfers')
    await tr.enqueueUpload('a', 'c')
    await settle(tr)
    expect(uploadOpts.length).toBe(1)
    expect(uploadOpts[0]!.maxSingleShotSize).toBe(8 * 1024 * 1024)
    expect(uploadOpts[0]!.concurrency).toBe(8)
  })
})
