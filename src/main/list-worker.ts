/* Listing worker thread. The Azure SDK parses each 5,000-item list page
 * synchronously (~450 ms of XML for a full page), which used to stall every
 * IPC call and transfer progress update in the main process. Here it only
 * blocks this thread; the main process gets back one JSON string per page. */
import { parentPort } from 'node:worker_threads'
import { prewarmAzureSdk } from './azure-clients'
import { listPage, type ListPageRequest } from './list-page'
import type { ListWorkerReply } from './list-runner'

const port = parentPort
if (!port) throw new Error('list-worker must run as a worker thread')

// Pay the SDK's module load here, off the main thread, before the first listing.
setImmediate(prewarmAzureSdk)

port.on('message', (msg: { id: number; req: ListPageRequest }) => {
  void listPage(msg.req).then(
    (res) => {
      const reply: ListWorkerReply = {
        id: msg.id,
        ok: true,
        itemsJson: JSON.stringify(res.items),
        count: res.items.length,
        continuationToken: res.continuationToken
      }
      port.postMessage(reply)
    },
    (err: unknown) => {
      const e = err as { message?: unknown; name?: unknown; code?: unknown; statusCode?: unknown }
      const reply: ListWorkerReply = {
        id: msg.id,
        ok: false,
        message: typeof e?.message === 'string' ? e.message : String(err),
        name: typeof e?.name === 'string' ? e.name : undefined,
        code: typeof e?.code === 'string' ? e.code : undefined,
        statusCode: typeof e?.statusCode === 'number' ? e.statusCode : undefined
      }
      port.postMessage(reply)
    }
  )
})
