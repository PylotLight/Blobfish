/**
 * Pure SAS / connection-string parsing. No Electron imports — safe to use
 * from main, tests, or the renderer for client-side hints.
 */

export function isConnectionString(secret: string): boolean {
  const s = secret.trim()
  return (
    s.includes('AccountName=') ||
    s.includes('DefaultEndpointsProtocol=') ||
    s === 'UseDevelopmentStorage=true'
  )
}

export function parseConnectionString(secret: string): {
  endpoint: string
  accountName?: string
} {
  const s = secret.trim()
  const get = (key: string): string | undefined => {
    const m = s.match(new RegExp(`${key}=([^;]+)`))
    return m?.[1]?.trim()
  }
  if (s === 'UseDevelopmentStorage=true') {
    return {
      endpoint: 'http://127.0.0.1:10000/devstoreaccount1',
      accountName: 'devstoreaccount1'
    }
  }
  const accountName = get('AccountName')
  const blobEndpoint = get('BlobEndpoint')
  if (blobEndpoint) {
    return { endpoint: blobEndpoint.replace(/\/+$/, ''), accountName }
  }
  const suffix = get('EndpointSuffix') ?? 'core.windows.net'
  const protocol = get('DefaultEndpointsProtocol') ?? 'https'
  if (accountName) {
    return { endpoint: `${protocol}://${accountName}.blob.${suffix}`, accountName }
  }
  throw new Error('Unrecognised connection string: missing AccountName.')
}

export interface ParsedSasUrl {
  endpoint: string
  containerName?: string
  prefix?: string
  accountName?: string
  sasExpiry?: string | null
}

/** Parse a full SAS URL into endpoint + optional container/prefix. */
export function parseSasUrl(secret: string): ParsedSasUrl {
  let url: URL
  try {
    url = new URL(secret.trim())
  } catch {
    throw new Error('Secret is not a connection string or a valid SAS URL.')
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('SAS URL must start with https:// (or http:// for local Azurite).')
  }
  if (!url.searchParams.has('sig') && !url.searchParams.has('se')) {
    if (!url.searchParams.has('sv')) {
      throw new Error('URL has no SAS token query (?sv=…&sig=…). Paste the full SAS URL.')
    }
  }
  const endpoint = `${url.protocol}//${url.host}`
  const segments = url.pathname.split('/').filter(Boolean).map(decodeURIComponent)
  const containerName = segments[0]
  const prefix = segments.length > 1 ? segments.slice(1).join('/') : undefined
  const hostAccount = url.host.split('.')[0]
  const sasExpiry = url.searchParams.get('se')
  return { endpoint, containerName, prefix, accountName: hostAccount, sasExpiry }
}

export function cleanPrefix(p?: string): string | undefined {
  if (!p) return undefined
  const cleaned = p.trim().replace(/^\/+|\/+$/g, '')
  return cleaned === '' ? undefined : cleaned
}

export function joinPrefix(base?: string, extra?: string): string | undefined {
  const b = cleanPrefix(base)
  const e = cleanPrefix(extra)
  if (b && e) return `${b}/${e}`
  return b ?? e
}

/**
 * Suggest a display name from a connection secret, e.g.
 * `AccountName=myacct` → `myacct`, container SAS → `myacct / mycontainer`.
 * Used to pre-fill the wizard name field and as a main-side fallback.
 */
export function suggestDisplayName(
  secret: string,
  containerOverride?: string,
  prefixOverride?: string
): string {
  const s = secret.trim()
  if (isConnectionString(s)) {
    try {
      const parsed = parseConnectionString(s)
      const acct = parsed.accountName ?? 'azurite'
      const c = containerOverride?.trim() || prefixOverride?.trim()
      return c ? `${acct} / ${c}` : acct
    } catch {
      return 'Storage account'
    }
  }
  try {
    const parsed = parseSasUrl(s)
    const acct = parsed.accountName ?? 'storage'
    const c = containerOverride?.trim() || parsed.containerName
    if (!c) return acct
    const p = prefixOverride?.trim() || parsed.prefix
    return p ? `${acct} / ${c} / ${p}` : `${acct} / ${c}`
  } catch {
    return ''
  }
}
