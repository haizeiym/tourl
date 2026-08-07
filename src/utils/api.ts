import type { JumpConfigFile } from '../types/jump'
import { parseJumpConfig } from './jump'

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

/** 拉取全局配置（强制无缓存） */
export async function fetchGlobalConfig(): Promise<JumpConfigFile> {
  const res = await fetch(`/api/config?_t=${Date.now()}`, {
    method: 'GET',
    cache: 'no-store',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(await parseError(res))
  }
  const raw: unknown = await res.json()
  return parseJumpConfig(raw)
}

export class ConfigConflictError extends Error {
  serverConfig: JumpConfigFile

  constructor(message: string, serverConfig: JumpConfigFile) {
    super(message)
    this.name = 'ConfigConflictError'
    this.serverConfig = serverConfig
  }
}

/** 保存全局配置；force=true 时忽略乐观锁 */
export async function saveGlobalConfig(
  config: JumpConfigFile,
  force = false,
): Promise<JumpConfigFile> {
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

  if (!res.ok) {
    throw new Error(await parseError(res))
  }

  const raw: unknown = await res.json()
  return parseJumpConfig(raw)
}
