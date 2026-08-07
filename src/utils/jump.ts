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

export function createEmptyConfig(): JumpConfigFile {
  return { items: [] }
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
  return {
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
