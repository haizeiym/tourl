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

/**
 * 全员必须同一地址：以站点 data/cloud-url.txt 为准（覆盖本机 localStorage，避免每人一份）
 */
export async function resolveCloudUrl(): Promise<string | null> {
  const fromFile = await fetchText('/data/cloud-url.txt')
  if (fromFile) {
    const url = parseCloudUrlFile(fromFile)
    if (url) {
      try {
        localStorage.setItem(LS_CLOUD, url)
      } catch {
        /* ignore */
      }
      return url
    }
  }

  // 仅当站点尚未部署 cloud-url 时，才用本机缓存（并提示不一致风险由保存/构建修复）
  try {
    const fromLs = localStorage.getItem(LS_CLOUD)
    if (fromLs && /^https?:\/\//i.test(fromLs)) return fromLs
  } catch {
    /* ignore */
  }
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
    throw new Error('云端配置读取失败，请检查网络或重新打包部署')
  }

  // 无云端地址时退回静态文件（只读，且全员应相同）
  const local = await fetchJson('/data/jump-config.json')
  if (local) return parseJumpConfig(local)

  const root = await fetchJson('/jump-config.json')
  if (root) return parseJumpConfig(root)

  throw new Error('无法加载配置：请重新执行 npm run build 并上传完整 dist')
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
      '缺少全员共用云端地址。请在项目里执行 npm run build（会生成 data/cloud-url.txt）后重新上传整个 dist',
    )
  }

  const saved = await putToCloud(cloud, config, force)
  return { config: saved }
}
