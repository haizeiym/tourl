import type { JumpConfigFile } from '../types/jump'
import { parseJumpConfig } from './jump'

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
