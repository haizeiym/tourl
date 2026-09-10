import type { JumpConfigFile, LobbyConfig } from '../types/jump'
import type { FieldLayoutFile, ItemLayoutFile } from '../types/layout'
import { parseFieldLayout, parseItemLayout } from '../types/layout'
import { parseJumpConfig } from './jump'
import { parseLobbyConfig } from './lobby'

const LS_CLOUD = 'jumpl.cloudConfigUrl'

async function parseError(res: Response): Promise<string> {
  try {
    const data: unknown = await res.json()
    if (
      typeof data === 'object' &&
      data !== null &&
      'error' in data &&
      typeof (data as { error: unknown }).error === 'string'
    ) {
      return (data as { error: string }).error
    }
  } catch {
    /* ignore */
  }
  return `请求失败 (${res.status})`
}

function cacheBust(url: string): string {
  const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://local')
  u.searchParams.set('_t', String(Date.now()))
  return u.toString()
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(cacheBust(url), { cache: 'no-store' })
    if (!res.ok) return null
    return (await res.text()).trim()
  } catch {
    return null
  }
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const res = await fetch(cacheBust(url), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const text = await res.text()
    if (!text.trimStart().startsWith('{')) return null
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function parseCloudUrlFile(text: string): string | null {
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#') && /^https?:\/\//i.test(l))
  return line ?? null
}

/** 不稳定/会过期的第三方，禁止作为生产持久化源 */
function isUnstableStoreUrl(url: string): boolean {
  return /jsonblob\.com|jsonbin\.io|httpbin\.org|pastebin\.com/i.test(url)
}

function rememberCloudUrl(url: string | null) {
  try {
    if (url) localStorage.setItem(LS_CLOUD, url)
    else localStorage.removeItem(LS_CLOUD)
  } catch {
    /* ignore */
  }
}

/**
 * 全员必须同一地址：以站点 data/cloud-url.txt 为准。
 * 拒绝 jsonblob（会过期）；并清理本机缓存里的失效地址。
 */
export async function resolveCloudUrl(): Promise<string | null> {
  const fromFile = await fetchText('/data/cloud-url.txt')
  if (fromFile) {
    const url = parseCloudUrlFile(fromFile)
    if (url) {
      if (isUnstableStoreUrl(url)) {
        console.warn('[resolveCloudUrl] 不稳定存储已忽略（禁止 jsonblob 等）', url)
        rememberCloudUrl(null)
        return null
      }
      rememberCloudUrl(url)
      return url
    }
  }

  // 站点文件无有效地址时，才看本机缓存（同样拒绝不稳定源）
  try {
    const fromLs = localStorage.getItem(LS_CLOUD)
    if (fromLs && /^https?:\/\//i.test(fromLs)) {
      if (isUnstableStoreUrl(fromLs)) {
        rememberCloudUrl(null)
        return null
      }
      return fromLs
    }
  } catch {
    /* ignore */
  }
  return null
}
async function fetchLocalFallback(): Promise<JumpConfigFile | null> {
  const local = await fetchJson('/data/jump-config.json')
  if (local) return parseJumpConfig(local)
  const root = await fetchJson('/jump-config.json')
  if (root) return parseJumpConfig(root)
  return null
}

/** 拉取全局配置：有云端则只读云端，保证全员一致 */
export async function fetchGlobalConfig(): Promise<JumpConfigFile> {
  if (import.meta.env.DEV) {
    const raw = await fetchJson('/api/config')
    if (raw) return parseJumpConfig(raw)
  }

  const cloud = await resolveCloudUrl()
  if (cloud) {
    const raw = await fetchJson(cloud)
    if (raw) return parseJumpConfig(raw)
    // 云端失效（如 jsonblob 404/过期）时回退静态文件，避免整站打不开
    console.warn('[fetchGlobalConfig] 云端不可用，回退本地 jump-config.json', cloud)
    const fallback = await fetchLocalFallback()
    if (fallback) return fallback
    throw new Error(
      '云端配置读取失败。若仍使用 jsonblob，数据可能已过期；请按 README 部署 config-api（Cloudflare Worker）并更新 data/cloud-url.txt',
    )
  }

  const fallback = await fetchLocalFallback()
  if (fallback) return fallback

  throw new Error('无法加载配置：请确认已上传 dist，并配置持久化 data/cloud-url.txt')
}
export class ConfigConflictError extends Error {
  serverConfig: JumpConfigFile

  constructor(message: string, serverConfig: JumpConfigFile) {
    super(message)
    this.name = 'ConfigConflictError'
    this.serverConfig = serverConfig
  }
}

export type SaveGlobalResult = {
  config: JumpConfigFile
}

async function putToCloud(
  cloudUrl: string,
  config: JumpConfigFile,
  force: boolean,
): Promise<JumpConfigFile> {
  if (!force) {
    const latestRaw = await fetchJson(cloudUrl)
    if (latestRaw) {
      const latest = parseJumpConfig(latestRaw)
      if (latest.updatedAt !== config.updatedAt) {
        throw new ConfigConflictError('配置已被他人更新，请刷新后重试或强制覆盖', latest)
      }
    }
  }

  const next: JumpConfigFile = {
    updatedAt: Date.now(),
    items: config.items,
  }

  const putUrl = new URL(cloudUrl)
  if (force) putUrl.searchParams.set('force', '1')
  const res = await fetch(putUrl.toString(), {
    method: 'PUT',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(next),
  })
  if (res.status === 409) {
    const data: unknown = await res.json()
    let serverConfig: JumpConfigFile = { updatedAt: Date.now(), items: [] }
    let message = '配置已被他人更新'
    if (typeof data === 'object' && data !== null) {
      const obj = data as { error?: unknown; serverConfig?: unknown }
      if (typeof obj.error === 'string') message = obj.error
      if (obj.serverConfig) {
        try {
          serverConfig = parseJumpConfig(obj.serverConfig)
        } catch {
          /* ignore */
        }
      }
    }
    throw new ConfigConflictError(message, serverConfig)
  }
  if (!res.ok) throw new Error(await parseError(res))

  const again = await fetchJson(cloudUrl)
  if (again) return parseJumpConfig(again)
  return next
}

/** 保存全局配置（必须已有全员共用的 cloud-url，禁止每人新建一份） */
export async function saveGlobalConfig(
  config: JumpConfigFile,
  force = false,
): Promise<SaveGlobalResult> {
  if (import.meta.env.DEV) {
    const qs = force ? '?force=1' : ''
    const res = await fetch(`/api/config${qs}`, {
      method: 'PUT',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(config),
    })
    if (res.status === 409) {
      const data: unknown = await res.json()
      let serverConfig: JumpConfigFile | null = null
      let message = '配置已被他人更新'
      if (typeof data === 'object' && data !== null) {
        const obj = data as { error?: unknown; serverConfig?: unknown }
        if (typeof obj.error === 'string') message = obj.error
        if (obj.serverConfig) {
          try {
            serverConfig = parseJumpConfig(obj.serverConfig)
          } catch {
            serverConfig = null
          }
        }
      }
      throw new ConfigConflictError(
        message,
        serverConfig ?? { updatedAt: Date.now(), items: [] },
      )
    }
    if (!res.ok) throw new Error(await parseError(res))
    return { config: parseJumpConfig(await res.json()) }
  }

  const cloud = await resolveCloudUrl()
  if (!cloud) {
    throw new Error(
      '未配置稳定持久化 API。请按 README 部署 config-api（Cloudflare Worker + KV），将固定地址写入 data/cloud-url.txt 并上传。禁止使用 jsonblob 等会过期的服务',
    )
  }

  try {
    const saved = await putToCloud(cloud, config, force)
    return { config: saved }
  } catch (err) {
    if (err instanceof ConfigConflictError) throw err
    const msg = err instanceof Error ? err.message : '保存失败'
    throw new Error(`${msg}。请确认 Worker 已部署且 cloud-url.txt 指向该 Worker（先导出备份）`)
  }
}

function resourceApiUrl(cloudConfigUrl: string, suffix: string): string {
  const u = new URL(cloudConfigUrl)
  const basePath = u.pathname.replace(/\/config\/?$/, '')
  u.pathname = `${basePath}${suffix}`
  u.search = ''
  u.hash = ''
  return u.toString()
}

/** 由 cloud-url（.../config）推导大厅项地址 .../lobby/:id */
function lobbyApiUrl(itemId: string, cloudConfigUrl: string): string {
  return resourceApiUrl(cloudConfigUrl, `/lobby/${encodeURIComponent(itemId)}`)
}

async function requestJson(url: string): Promise<{ ok: boolean; status: number; data: unknown | null }> {
  try {
    const res = await fetch(cacheBust(url), {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
    })
    let data: unknown = null
    try {
      const text = await res.text()
      if (text.trimStart().startsWith('{') || text.trimStart().startsWith('[')) {
        data = JSON.parse(text) as unknown
      }
    } catch {
      /* ignore body */
    }
    return { ok: res.ok, status: res.status, data }
  } catch {
    return { ok: false, status: 0, data: null }
  }
}

export async function fetchLobbyConfig(itemId: string): Promise<LobbyConfig | null> {
  const path = `/api/lobby/${encodeURIComponent(itemId)}`
  const result = import.meta.env.DEV
    ? await requestJson(path)
    : await (async () => {
        const cloud = await resolveCloudUrl()
        if (!cloud) return { ok: false, status: 0, data: null }
        return requestJson(lobbyApiUrl(itemId, cloud))
      })()

  if (!result.ok || result.data == null) return null
  try {
    return parseLobbyConfig(result.data)
  } catch (err) {
    console.warn('[fetchLobbyConfig] parse failed', err)
    return null
  }
}

/** 一次拉取 JUMP_LOBBY 全部大厅参数 */
export async function fetchAllLobbyConfigs(): Promise<Record<string, LobbyConfig>> {
  const cloud = await resolveCloudUrl()
  const urls: string[] = []
  if (import.meta.env.DEV) {
    urls.push('/api/lobbies')
    if (cloud) urls.push(resourceApiUrl(cloud, '/lobbies'))
  } else {
    if (cloud) urls.push(resourceApiUrl(cloud, '/lobbies'))
    urls.push('/api/lobbies')
  }

  const out: Record<string, LobbyConfig> = {}
  for (const url of urls) {
    const result = await requestJson(url)
    if (!result.ok || typeof result.data !== 'object' || result.data === null) {
      continue
    }
    const map = (result.data as { lobbies?: unknown }).lobbies
    if (!map || typeof map !== 'object') continue
    for (const [id, value] of Object.entries(map as Record<string, unknown>)) {
      try {
        out[id] = parseLobbyConfig(value)
      } catch {
        /* skip */
      }
    }
    if (Object.keys(out).length > 0) return out
  }

  if (Object.keys(out).length === 0) {
    console.warn('[fetchAllLobbyConfigs] JUMP_LOBBY 为空或读取失败')
  }
  return out
}

export async function saveLobbyConfig(
  itemId: string,
  lobby: LobbyConfig,
): Promise<LobbyConfig> {
  const body = JSON.stringify(lobby)

  if (import.meta.env.DEV) {
    const res = await fetch(`/api/lobby/${encodeURIComponent(itemId)}`, {
      method: 'PUT',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body,
    })
    if (!res.ok) throw new Error(await parseError(res))
    return parseLobbyConfig(await res.json())
  }

  const cloud = await resolveCloudUrl()
  if (!cloud) {
    throw new Error('未配置稳定持久化 API，无法保存大厅参数')
  }
  const res = await fetch(lobbyApiUrl(itemId, cloud), {
    method: 'PUT',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body,
  })
  if (!res.ok) throw new Error(await parseError(res))
  return parseLobbyConfig(await res.json())
}

export async function deleteLobbyConfig(itemId: string): Promise<void> {
  if (import.meta.env.DEV) {
    const res = await fetch(`/api/lobby/${encodeURIComponent(itemId)}`, {
      method: 'DELETE',
      cache: 'no-store',
    })
    if (!res.ok && res.status !== 404) throw new Error(await parseError(res))
    return
  }

  const cloud = await resolveCloudUrl()
  if (!cloud) return
  const res = await fetch(lobbyApiUrl(itemId, cloud), {
    method: 'DELETE',
    cache: 'no-store',
  })
  if (!res.ok && res.status !== 404) throw new Error(await parseError(res))
}

export type BackupResult = {
  ok: boolean
  backedAt: number
  configKeys: number
  lobbyKeys: number
}

function backupApiUrl(cloudConfigUrl: string): string {
  return resourceApiUrl(cloudConfigUrl, '/backup')
}

/** 把 JUMP_CONFIG / JUMP_LOBBY 全量快照到 Cloudflare 备份 KV（有 cloud-url 时必写远端） */
export async function backupGlobalStores(): Promise<BackupResult> {
  const parse = async (res: Response): Promise<BackupResult> => {
    if (!res.ok) throw new Error(await parseError(res))
    const data: unknown = await res.json()
    if (typeof data !== 'object' || data === null) {
      throw new Error('备份返回无效')
    }
    const obj = data as Record<string, unknown>
    return {
      ok: obj.ok === true,
      backedAt: typeof obj.backedAt === 'number' ? obj.backedAt : Date.now(),
      configKeys: typeof obj.configKeys === 'number' ? obj.configKeys : 0,
      lobbyKeys: typeof obj.lobbyKeys === 'number' ? obj.lobbyKeys : 0,
    }
  }

  const cloud = await resolveCloudUrl()
  if (cloud) {
    const res = await fetch(backupApiUrl(cloud), {
      method: 'POST',
      cache: 'no-store',
    })
    const result = await parse(res)
    if (import.meta.env.DEV) {
      try {
        await fetch('/api/backup', { method: 'POST', cache: 'no-store' })
      } catch (err) {
        console.warn('[backupGlobalStores] 本地 data/backup 同步失败', err)
      }
    }
    return result
  }

  if (import.meta.env.DEV) {
    const res = await fetch('/api/backup', { method: 'POST', cache: 'no-store' })
    return parse(res)
  }

  throw new Error('未配置稳定持久化 API，无法备份')
}

async function layoutGetPut(suffix: string, body?: unknown): Promise<unknown | null> {
  const cloud = await resolveCloudUrl()
  const urls: string[] = []
  const local = `/api/layout/${suffix}`
  if (cloud) urls.push(resourceApiUrl(cloud, `/layout/${suffix}`))
  if (import.meta.env.DEV) urls.push(local)
  else urls.push(local)

  if (body === undefined) {
    for (const url of urls) {
      const result = await requestJson(url)
      if (result.ok && result.data) return result.data
    }
    return null
  }

  const payload = JSON.stringify(body)
  const targets = cloud
    ? [resourceApiUrl(cloud, `/layout/${suffix}`), ...(import.meta.env.DEV ? [local] : [])]
    : import.meta.env.DEV
      ? [local]
      : []
  if (targets.length === 0) {
    throw new Error('未配置稳定持久化 API，无法保存位置')
  }
  let lastErr = '保存位置失败'
  let saved: unknown | null = null
  for (const url of targets) {
    try {
      const res = await fetch(url, {
        method: 'PUT',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: payload,
      })
      if (!res.ok) {
        lastErr = await parseError(res)
        continue
      }
      saved = await res.json()
    } catch (err) {
      lastErr = err instanceof Error ? err.message : lastErr
    }
  }
  if (saved == null && cloud) {
    throw new Error(lastErr)
  }
  return saved
}

export async function fetchItemLayout(): Promise<ItemLayoutFile> {
  return parseItemLayout(await layoutGetPut('items'))
}

export async function fetchFieldLayout(): Promise<FieldLayoutFile> {
  return parseFieldLayout(await layoutGetPut('fields'))
}

export async function saveItemLayout(layout: ItemLayoutFile): Promise<ItemLayoutFile> {
  const saved = await layoutGetPut('items', layout)
  return parseItemLayout(saved ?? layout)
}

export async function saveFieldLayout(layout: FieldLayoutFile): Promise<FieldLayoutFile> {
  const saved = await layoutGetPut('fields', layout)
  return parseFieldLayout(saved ?? layout)
}
