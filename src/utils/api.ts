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

/** 打包参数。空字符串表示读写默认 KV（JUMP_CONFIG 等）。 */
function kvProfile(): string {
  if (import.meta.env.DEV) return ''
  const raw = import.meta.env.VITE_KV_PROFILE
  return typeof raw === 'string' ? raw.trim() : ''
}

function withKv(url: string): string {
  const profile = kvProfile()
  if (!profile) return url
  const u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://local')
  u.searchParams.set('kv', profile)
  return u.toString()
}

function cacheBust(url: string): string {
  const u = new URL(withKv(url), typeof window !== 'undefined' ? window.location.origin : 'http://local')
  u.searchParams.set('_t', String(Date.now()))
  return u.toString()
}

if (kvProfile()) {
  console.info(`[kv] 当前包读取独立 KV 后缀 _${kvProfile()}`)
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

  const putUrl = new URL(withKv(cloudUrl))
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
  const res = await fetch(withKv(lobbyApiUrl(itemId, cloud)), {
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
  const res = await fetch(withKv(lobbyApiUrl(itemId, cloud)), {
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
    const res = await fetch(withKv(backupApiUrl(cloud)), {
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
      const res = await fetch(withKv(url), {
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

export type SendScreenshotEmailPayload = {
  to: string
  imageDataUrl?: string
  coverImageDataUrl?: string
  mediaBlob?: Blob
  mediaFilename?: string
  mediaMimeType?: string
  durationSec?: number
  windowWidth?: number
  windowHeight?: number
  maxBytes?: number
  pageUrl: string
  subject?: string
  content?: string
}

export type SendScreenshotEmailResult = {
  ok: boolean
  mode?: string
  publicFileUrl?: string
  message?: string
}

function dataUrlToBlob(dataUrl: string, fallbackType = 'image/png'): Blob {
  const marker = ';base64,'
  const idx = dataUrl.indexOf(marker)
  const header = idx >= 0 ? dataUrl.slice(0, idx) : ''
  const mime = header.startsWith('data:')
    ? header.slice(5).split(';')[0] || fallbackType
    : fallbackType
  const base64 = idx >= 0 ? dataUrl.slice(idx + marker.length) : ''
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) {
    bytes[i] = bin.charCodeAt(i)
  }
  return new Blob([bytes], { type: mime })
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('读取媒体数据失败'))
    reader.readAsDataURL(blob)
  })
}

function ensureOriginReferrerMeta() {
  if (typeof document === 'undefined') return
  let meta = document.querySelector('meta[name="referrer"]') as HTMLMetaElement | null
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'referrer'
    document.head.appendChild(meta)
  }
  meta.content = 'origin'
}

function getPersistentMailIframe(): HTMLIFrameElement {
  const id = 'jumpl-formsubmit-iframe'
  let iframe = document.getElementById(id) as HTMLIFrameElement | null
  if (!iframe) {
    iframe = document.createElement('iframe')
    iframe.id = id
    iframe.name = id
    iframe.style.display = 'none'
    document.body.appendChild(iframe)
  }
  return iframe
}

const FORMSUBMIT_MAX_ATTACH_BYTES = 4_500_000

async function submitFormToIframe(
  to: string,
  fields: Record<string, string>,
  attachFile?: File | null,
): Promise<boolean> {
  const iframe = getPersistentMailIframe()
  const nextToken = `mail_ok=1&t=${Date.now()}`
  const nextUrl = `${window.location.origin}/?${nextToken}`

  const form = document.createElement('form')
  form.method = 'POST'
  form.enctype = 'multipart/form-data'
  form.action = `https://formsubmit.co/${encodeURIComponent(to)}`
  form.target = iframe.name
  form.style.display = 'none'

  const allFields: Record<string, string> = {
    ...fields,
    _next: nextUrl,
  }

  for (const [k, v] of Object.entries(allFields)) {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = k
    input.value = v
    form.appendChild(input)
  }

  if (attachFile && attachFile.size > 0) {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.name = 'attachment'
    const dt = new DataTransfer()
    dt.items.add(attachFile)
    fileInput.files = dt.files
    form.appendChild(fileInput)
  }

  document.body.appendChild(form)

  const savedHref = window.location.href
  try {
    // 临时将地址栏精简为纯路径，彻底杜绝超长 ?preview= JWT 污染 Referer
    window.history.replaceState(null, '', window.location.pathname)
  } catch {
    /* ignore */
  }

  const redirectedOk = await new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (ok: boolean) => {
      if (settled) return
      settled = true
      iframe.onload = null
      iframe.onerror = null
      form.remove()
      resolve(ok)
    }
    iframe.onload = () => {
      try {
        const href = iframe.contentWindow?.location?.href ?? ''
        if (href.includes('mail_ok=1')) {
          finish(true)
          return
        }
      } catch {
        // 跨域说明停留在 formsubmit.co（未跳转到同源 _next，例如视频附件被拒）
      }
      finish(false)
    }
    iframe.onerror = () => finish(false)
    window.setTimeout(() => finish(false), 10000)
    form.submit()
  })

  try {
    window.history.replaceState(null, '', savedHref)
  } catch {
    /* ignore */
  }

  return redirectedOk
}

/**
 * 当视频二进制无法直传时，将 publicFileUrl 发送到邮箱（优先 AJAX JSON 投递，备选挂载 PNG 预览帧表单投递）
 */
async function sendPublicUrlFallback(
  to: string,
  fields: Record<string, string>,
  coverImageDataUrl?: string,
): Promise<void> {
  const savedHref = window.location.href
  try {
    window.history.replaceState(null, '', window.location.pathname)
  } catch {
    /* ignore */
  }

  let ajaxSent = false
  try {
    const res = await fetch(`https://formsubmit.co/ajax/${encodeURIComponent(to)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(fields),
    })
    if (res.ok) {
      const data = (await res.json()) as Record<string, unknown>
      if (data.success === 'true' || data.success === true) {
        ajaxSent = true
      }
    }
  } catch {
    /* fallback to form below */
  } finally {
    try {
      window.history.replaceState(null, '', savedHref)
    } catch {
      /* ignore */
    }
  }

  if (ajaxSent) return

  const coverBlob = coverImageDataUrl
    ? dataUrlToBlob(coverImageDataUrl, 'image/png')
    : null
  const coverFile =
    coverBlob && coverBlob.size > 0
      ? new File([coverBlob], `recording-preview-${Date.now()}.png`, { type: 'image/png' })
      : null
  await submitFormToIframe(to, fields, coverFile)
}

/**
 * 浏览器端直传公共临时云存储，获取真实可访问的 HTTPS 视频直链（避免静态站点无后端导致 404）
 */
async function uploadVideoDirectFromBrowser(blob: Blob, filename: string): Promise<string> {
  if (!blob || blob.size === 0) return ''
  // 1. tmpfiles.org (支持浏览器 CORS)
  try {
    const fd = new FormData()
    fd.append('file', blob, filename)
    const res = await fetch('https://tmpfiles.org/api/v1/upload', {
      method: 'POST',
      body: fd,
    })
    if (res.ok) {
      const data = (await res.json()) as { data?: { url?: string } }
      const rawUrl = typeof data?.data?.url === 'string' ? data.data.url : ''
      if (rawUrl) {
        return rawUrl.replace('http://', 'https://').replace('://tmpfiles.org/', '://tmpfiles.org/dl/')
      }
    }
  } catch {
    /* try next */
  }

  // 2. uguu.se (支持浏览器 CORS)
  try {
    const fd = new FormData()
    fd.append('files[]', blob, filename)
    const res = await fetch('https://uguu.se/upload', {
      method: 'POST',
      body: fd,
    })
    if (res.ok) {
      const data = (await res.json()) as { files?: Array<{ url?: string }> }
      const url = data?.files?.[0]?.url
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
        return url
      }
    }
  } catch {
    /* try next */
  }

  // 3. litterbox.catbox.moe
  try {
    const fd = new FormData()
    fd.append('reqtype', 'fileupload')
    fd.append('time', '72h')
    fd.append('fileToUpload', blob, filename)
    const res = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
      method: 'POST',
      body: fd,
    })
    if (res.ok) {
      const text = (await res.text()).trim()
      if (/^https?:\/\//i.test(text)) {
        return text
      }
    }
  } catch {
    /* ignore */
  }

  return ''
}

/**
 * 免密钥表单邮件网关投递：
 * - 截图：直接挂载 PNG 附件发送
 * - 录屏：优先尝试直接发送 MP4 视频附件（≤ 4.5MB）；如果视频发送不了（体积超限或被邮件网关拒收），自动降级将 publicFileUrl 发送到邮箱
 */
async function relayViaFormSubmit(
  payload: SendScreenshotEmailPayload,
  serverFileUrl?: string,
  localFileUrl?: string,
): Promise<SendScreenshotEmailResult> {
  ensureOriginReferrerMeta()
  const to = payload.to.trim() || 'gcdxdy666@gmail.com'
  const isVideo = Boolean(
    payload.mediaMimeType?.startsWith('video/') || payload.mediaBlob?.type.startsWith('video/'),
  )
  const kindLabel = isVideo ? '网页录屏' : '网页截图'
  const userSubject = payload.subject?.trim() ?? ''
  const userContent = payload.content?.trim() ?? ''
  const subject =
    userSubject ||
    `${kindLabel} (${new Date().toISOString().slice(0, 19).replace('T', ' ')})`

  const mimeType =
    payload.mediaMimeType ||
    payload.mediaBlob?.type ||
    'image/png'
  const blob =
    payload.mediaBlob ??
    (payload.imageDataUrl ? dataUrlToBlob(payload.imageDataUrl, mimeType) : new Blob([]))
  const defaultExt = isVideo ? (mimeType.includes('mp4') ? 'mp4' : 'webm') : 'png'
  const filename =
    payload.mediaFilename || `${isVideo ? 'recording' : 'screenshot'}-${Date.now()}.${defaultExt}`

  const sizeMb = (blob.size / (1024 * 1024)).toFixed(2)
  let resolvedPublicUrl = serverFileUrl || localFileUrl || ''
  if (isVideo && (!resolvedPublicUrl || resolvedPublicUrl.includes('/api/screenshot/file/'))) {
    const browserCloudUrl = await uploadVideoDirectFromBrowser(blob, filename)
    if (browserCloudUrl) {
      resolvedPublicUrl = browserCloudUrl
    }
  }

  const fields: Record<string, string> = {
    _subject: subject,
    _captcha: 'false',
    _template: 'table',
    类型: isVideo
      ? `录屏视频 (${sizeMb} MB · ${blob.size.toLocaleString()} Bytes${payload.durationSec ? ` · ${payload.durationSec}s` : ''})`
      : `网页截图 (${sizeMb} MB)`,
    邮件标题: userSubject || '（未填写）',
    邮件内容: userContent || '（未填写）',
    页面地址: payload.pageUrl || window.location.origin,
    发送时间: new Date().toLocaleString(),
  }

  if (isVideo) {
    if (payload.windowWidth && payload.windowHeight) {
      fields['录屏窗口大小'] = `${payload.windowWidth} × ${payload.windowHeight} px`
    }
    if (payload.maxBytes) {
      fields['设置最大字节量'] = `${payload.maxBytes.toLocaleString()} Bytes (${(payload.maxBytes / (1024 * 1024)).toFixed(2)} MB)`
    }
    if (resolvedPublicUrl) {
      fields['publicFileUrl'] = resolvedPublicUrl
      fields['视频在线播放/下载直链'] = resolvedPublicUrl
    }
    if (localFileUrl && localFileUrl !== resolvedPublicUrl) {
      fields['本地播放/下载直链'] = localFileUrl
    }
  }

  if (!isVideo) {
    const pngFile =
      blob.size > 0 && blob.size <= FORMSUBMIT_MAX_ATTACH_BYTES
        ? new File([blob], filename, { type: 'image/png' })
        : null
    await submitFormToIframe(to, fields, pngFile)
    return {
      ok: true,
      mode: 'formsubmit',
      message: `${kindLabel}已发送至 ${to}`,
    }
  }

  // 1. 尝试直接发送视频附件（要求在网关字节上限内且为 MP4 兼容格式）
  const canTryVideoAttach =
    blob.size > 0 &&
    blob.size <= FORMSUBMIT_MAX_ATTACH_BYTES &&
    mimeType.includes('mp4')

  if (canTryVideoAttach) {
    const videoFile = new File([blob], filename, { type: 'video/mp4' })
    const sentVideoOk = await submitFormToIframe(to, fields, videoFile)
    if (sentVideoOk) {
      return {
        ok: true,
        mode: 'formsubmit_video',
        publicFileUrl: resolvedPublicUrl,
        message: `录屏视频已直接发送至 ${to}`,
      }
    }
  }

  // 2. 如果视频发送不了（超出字节上限或网关拦截视频附件），则发送 publicFileUrl 到邮箱
  await sendPublicUrlFallback(to, fields, payload.coverImageDataUrl)

  return {
    ok: true,
    mode: 'formsubmit_url_fallback',
    publicFileUrl: resolvedPublicUrl,
    message: `已将录屏链接 (publicFileUrl) 发送至 ${to}`,
  }
}

export async function sendScreenshotEmail(
  payload: SendScreenshotEmailPayload,
): Promise<SendScreenshotEmailResult> {
  const dataUrl =
    payload.imageDataUrl ??
    (payload.mediaBlob ? await blobToDataUrl(payload.mediaBlob) : '')
  const body = JSON.stringify({
    to: payload.to,
    imageDataUrl: dataUrl,
    mediaFilename: payload.mediaFilename,
    mediaMimeType: payload.mediaMimeType || payload.mediaBlob?.type,
    durationSec: payload.durationSec,
    windowWidth: payload.windowWidth,
    windowHeight: payload.windowHeight,
    maxBytes: payload.maxBytes,
    pageUrl: payload.pageUrl,
    subject: payload.subject,
    content: payload.content,
  })
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  }

  let serverFileUrl: string | undefined
  let localFileUrl: string | undefined

  if (import.meta.env.DEV) {
    try {
      const res = await fetch('/api/screenshot/email', {
        method: 'POST',
        cache: 'no-store',
        headers,
        body,
      })
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>
        if (typeof data.publicFileUrl === 'string' && data.publicFileUrl) {
          serverFileUrl = data.publicFileUrl
        } else if (typeof data.fileUrl === 'string' && data.fileUrl) {
          serverFileUrl = data.fileUrl
        }
        if (typeof data.localFileUrl === 'string' && data.localFileUrl) {
          localFileUrl = data.localFileUrl
        }
        const mode = typeof data.mode === 'string' ? data.mode : ''
        if (mode && mode !== 'local' && mode !== 'client_relay') {
          return {
            ok: data.ok === true,
            mode,
            publicFileUrl: serverFileUrl,
            message: typeof data.message === 'string' ? data.message : undefined,
          }
        }
      } else {
        console.warn('[sendScreenshotEmail] dev server returned', res.status, 'falling back to relay')
      }
    } catch (err) {
      console.warn('[sendScreenshotEmail] dev server request failed, falling back to relay', err)
    }
    return relayViaFormSubmit(payload, serverFileUrl, localFileUrl)
  }

  // 生产环境 1：尝试同源 PHP 落盘接口 (/screenshot.php) 并校验文件真实可访问
  try {
    const phpRes = await fetch('/screenshot.php', {
      method: 'POST',
      cache: 'no-store',
      headers,
      body,
    })
    if (phpRes.ok) {
      const ct = phpRes.headers.get('content-type') ?? ''
      if (ct.includes('application/json')) {
        const data = (await phpRes.json()) as Record<string, unknown>
        const candidateUrl =
          typeof data.publicFileUrl === 'string'
            ? data.publicFileUrl
            : typeof data.fileUrl === 'string'
              ? data.fileUrl
              : ''
        if (candidateUrl) {
          const check = await fetch(candidateUrl, { method: 'HEAD', cache: 'no-store' }).catch(() => null)
          if (check && check.ok) {
            serverFileUrl = candidateUrl
          }
        }
      }
    }
  } catch {
    /* ignore */
  }

  // 生产环境 2：尝试 Cloudflare Worker (/screenshot/email)
  const cloud = await resolveCloudUrl()
  if (cloud && !serverFileUrl) {
    try {
      const url = withKv(resourceApiUrl(cloud, '/screenshot/email'))
      const res = await fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers,
        body,
      })
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>
        if (typeof data.publicFileUrl === 'string' && data.publicFileUrl) {
          serverFileUrl = data.publicFileUrl
        } else if (typeof data.fileUrl === 'string' && data.fileUrl) {
          serverFileUrl = data.fileUrl
        }
        const mode = typeof data.mode === 'string' ? data.mode : ''
        if (mode && mode !== 'local' && mode !== 'client_relay') {
          return {
            ok: data.ok === true,
            mode,
            publicFileUrl: serverFileUrl,
            message: typeof data.message === 'string' ? data.message : undefined,
          }
        }
      }
    } catch (err) {
      console.warn('[sendScreenshotEmail] worker fallback to formsubmit', err)
    }
  }

  return relayViaFormSubmit(payload, serverFileUrl, localFileUrl)
}
