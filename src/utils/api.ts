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

/** 解析可写云端地址：站点文件 > localStorage */
export async function resolveCloudUrl(): Promise<string | null> {
  const fromFile = await fetchText('/data/cloud-url.txt')
  if (fromFile && /^https?:\/\//i.test(fromFile.split('\n')[0]!.trim())) {
    const url = fromFile.split('\n')[0]!.trim()
    try {
      localStorage.setItem(LS_CLOUD, url)
    } catch {
      /* ignore */
    }
    return url
  }
  try {
    const fromLs = localStorage.getItem(LS_CLOUD)
    if (fromLs && /^https?:\/\//i.test(fromLs)) return fromLs
  } catch {
    /* ignore */
  }
  return null
}

function rememberCloudUrl(url: string) {
  try {
    localStorage.setItem(LS_CLOUD, url)
  } catch {
    /* ignore */
  }
}

/** 供 UI 触发：下载 cloud-url.txt 方便上传到服务器 data/ */
export function downloadCloudUrlFile(url: string) {
  const blob = new Blob([`${url}\n`], { type: 'text/plain;charset=utf-8' })
  const href = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = href
  a.download = 'cloud-url.txt'
  a.click()
  URL.revokeObjectURL(href)
}

async function createCloudStore(seed: JumpConfigFile): Promise<string> {
  const res = await fetch('https://jsonblob.com/api/jsonBlob', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(seed),
  })
  if (!res.ok) {
    throw new Error(`创建云端配置失败 (${res.status})`)
  }
  const loc = res.headers.get('Location') || res.headers.get('location')
  if (!loc) throw new Error('创建云端配置失败：无 Location')
  return loc.startsWith('http') ? loc : `https://jsonblob.com${loc}`
}

/** 拉取全局配置 */
export async function fetchGlobalConfig(): Promise<JumpConfigFile> {
  // 1) 开发环境本地 API
  if (import.meta.env.DEV) {
    const raw = await fetchJson('/api/config')
    if (raw) return parseJumpConfig(raw)
  }

  // 2) 云端（多人可写）
  const cloud = await resolveCloudUrl()
  if (cloud) {
    const raw = await fetchJson(cloud)
    if (raw) return parseJumpConfig(raw)
  }

  // 3) 站点静态 JSON（你当前 nginx 已可访问）
  const local = await fetchJson('/data/jump-config.json')
  if (local) return parseJumpConfig(local)

  const root = await fetchJson('/jump-config.json')
  if (root) return parseJumpConfig(root)

  throw new Error('无法加载配置：请确认已上传 data/jump-config.json')
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
  /** 首次创建云端时为 true，需提示上传 cloud-url.txt */
  needUploadCloudUrl?: string
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

  const res = await fetch(cloudUrl, {
    method: 'PUT',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(next),
  })
  if (!res.ok) throw new Error(await parseError(res))

  const again = await fetchJson(cloudUrl)
  if (again) return parseJumpConfig(again)
  return next
}

/** 保存全局配置 */
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

  let cloud = await resolveCloudUrl()
  let needUploadCloudUrl: string | undefined

  if (!cloud) {
    cloud = await createCloudStore(config)
    rememberCloudUrl(cloud)
    downloadCloudUrlFile(cloud)
    needUploadCloudUrl = cloud
  }

  const saved = await putToCloud(cloud, config, force)
  return { config: saved, needUploadCloudUrl }
}
