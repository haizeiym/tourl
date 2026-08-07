import type { JumpConfigFile, JumpItem, OpenMode } from '../types/jump'

export function createJumpItem(): JumpItem {
  return {
    id: crypto.randomUUID(),
    openMode: 'tab',
    name: '未命名跳转',
    iconUrl: '',
    url: 'https://',
    args: {},
  }
}

/**
 * 从完整 URL 解析出跳转项：
 * - url = origin + pathname（不含 search；保留 hash）
 * - args = query 键值对（忽略空 key；忽略防缓存参数 `_t`）
 * - name = 路径末段，否则用 hostname
 */
export function createJumpItemFromUrl(raw: string): JumpItem {
  const trimmed = raw.trim()
  if (!isHttpUrl(trimmed)) {
    throw new Error('请填写有效的 http(s) 地址')
  }
  const parsed = new URL(trimmed)
  const args: Record<string, string> = {}
  parsed.searchParams.forEach((value, key) => {
    if (!key || key === '_t') return
    args[key] = value
  })

  const segments = parsed.pathname.split('/').filter(Boolean)
  const last = segments[segments.length - 1]
  const name = last ? decodeURIComponent(last) : parsed.hostname

  const base = `${parsed.origin}${parsed.pathname}${parsed.hash}`

  return {
    id: crypto.randomUUID(),
    openMode: 'tab',
    name: name.slice(0, 64) || '未命名跳转',
    iconUrl: '',
    url: base,
    args,
  }
}

export function createEmptyConfig(): JumpConfigFile {
  return { updatedAt: 0, items: [] }
}

export function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

/** 拼接最终跳转 URL：保留原 query，写入 args，追加 _t */
export function buildJumpUrl(item: JumpItem, now = Date.now()): string {
  const url = new URL(item.url)
  for (const [key, value] of Object.entries(item.args)) {
    if (!key) continue
    url.searchParams.set(key, value)
  }
  url.searchParams.set('_t', String(now))
  return url.toString()
}

export function displayInitial(name: string): string {
  const trimmed = name.trim()
  return trimmed ? [...trimmed][0]! : '?'
}

function isOpenMode(value: unknown): value is OpenMode {
  return value === 'tab' || value === 'iframe'
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }
  return Object.values(value).every((v) => typeof v === 'string')
}

function normalizeItem(raw: unknown, index: number): JumpItem {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(`第 ${index + 1} 项不是对象`)
  }
  const obj = raw as Record<string, unknown>
  if (typeof obj.id !== 'string' || !obj.id) {
    throw new Error(`第 ${index + 1} 项缺少有效 id`)
  }
  if (typeof obj.name !== 'string') {
    throw new Error(`第 ${index + 1} 项缺少 name`)
  }
  if (typeof obj.url !== 'string') {
    throw new Error(`第 ${index + 1} 项缺少 url`)
  }
  if (!isStringRecord(obj.args)) {
    throw new Error(`第 ${index + 1} 项 args 须为 Record<string, string>`)
  }

  const openMode: OpenMode = isOpenMode(obj.openMode) ? obj.openMode : 'tab'
  const iconUrl = typeof obj.iconUrl === 'string' ? obj.iconUrl : ''

  return {
    id: obj.id,
    openMode,
    name: obj.name,
    iconUrl,
    url: obj.url,
    args: { ...obj.args },
  }
}

/** 解析并校验导入的配置；失败抛 Error */
export function parseJumpConfig(raw: unknown): JumpConfigFile {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('配置根节点须为对象')
  }
  const obj = raw as Record<string, unknown>
  if (!Array.isArray(obj.items)) {
    throw new Error('缺少 items 数组')
  }
  const updatedAt = typeof obj.updatedAt === 'number' ? obj.updatedAt : 0
  return {
    updatedAt,
    items: obj.items.map((item, i) => normalizeItem(item, i)),
  }
}

export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: 'application/json;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
