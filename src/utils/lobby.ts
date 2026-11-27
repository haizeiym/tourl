import CryptoJS from 'crypto-js'
import type { JumpKind, LobbyConfig, LobbyUserAccount, OpenMode } from '../types/jump'
import { createId } from './jump'

const NICKNAMES = [
  '恭喜发财',
  '财源广进',
  '日进斗金',
  '金玉满堂',
  '富贵临门',
  '鸿运当头',
  '好运连连',
  '一路发发',
  '大吉大利',
  '财运亨通',
  '招财进宝',
  '福星高照',
]

export const MIN_MULTI_TAB_COUNT = 2
export const MAX_MULTI_TAB_COUNT = 12
export const DEFAULT_MULTI_TAB_COUNT = 2

export function clampMultiTabCount(val: unknown): number {
  const num = typeof val === 'number' ? val : Number(val)
  if (!Number.isFinite(num)) return DEFAULT_MULTI_TAB_COUNT
  return Math.min(MAX_MULTI_TAB_COUNT, Math.max(MIN_MULTI_TAB_COUNT, Math.round(num)))
}

export function isLobbyKind(kind: unknown): kind is JumpKind {
  return kind === 'lobby'
}

export function randomString(min = 8, max = 12): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  const len = Math.floor(Math.random() * (max - min + 1)) + min
  let result = ''
  for (let i = 0; i < len; i += 1) {
    result += chars[Math.floor(Math.random() * 62)]!
  }
  return result
}

export function generateLobbyUuid(exclude?: ReadonlySet<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = randomString(9, 9)
    if (!exclude || !exclude.has(candidate)) {
      return candidate
    }
  }
  return `${randomString(6, 6)}${Date.now().toString(36).slice(-3)}`
}

export function generateLobbyNickname(exclude?: ReadonlySet<string>): string {
  const available = NICKNAMES.filter((n) => !exclude || !exclude.has(n))
  if (available.length > 0) {
    return available[Math.floor(Math.random() * available.length)]!
  }
  for (let suffix = 2; suffix < 200; suffix += 1) {
    for (const base of NICKNAMES) {
      const candidate = `${base}${suffix}`
      if (!exclude || !exclude.has(candidate)) {
        return candidate
      }
    }
  }
  return `${NICKNAMES[0]!}${randomString(3, 3)}`
}

const LS_USER_KEY = 'jumpl.lobbyUser'
const LS_MULTI_USERS_KEY = 'jumpl.lobbyUsers'

export type LocalLobbyUser = {
  uuid: string
  nickname: string
}

function nonempty(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function readRawLocalUser(): Partial<LocalLobbyUser> {
  try {
    const raw = localStorage.getItem(LS_USER_KEY)
    if (!raw) return {}
    const obj = JSON.parse(raw) as unknown
    if (typeof obj !== 'object' || obj === null) return {}
    const rec = obj as Record<string, unknown>
    return {
      uuid: nonempty(rec.uuid) || undefined,
      nickname: nonempty(rec.nickname) || undefined,
    }
  } catch (err) {
    console.warn('[readLocalLobbyUser] 读取失败', err)
    return {}
  }
}

/** 写入本机 uuid/nickname；空值会重新随机 */
export function writeLocalLobbyUser(patch: Partial<LocalLobbyUser>): LocalLobbyUser {
  const cur = readRawLocalUser()
  const uuid = nonempty(patch.uuid !== undefined ? patch.uuid : cur.uuid) || generateLobbyUuid()
  const nickname =
    nonempty(patch.nickname !== undefined ? patch.nickname : cur.nickname) ||
    generateLobbyNickname()
  const next = { uuid, nickname }
  try {
    localStorage.setItem(LS_USER_KEY, JSON.stringify(next))
  } catch (err) {
    console.warn('[writeLocalLobbyUser] 写入失败', err)
  }
  return next
}

/** 读本机用户身份；没有则随机生成并落盘 */
export function ensureLocalLobbyUser(): LocalLobbyUser {
  const raw = readRawLocalUser()
  if (raw.uuid && raw.nickname) return { uuid: raw.uuid, nickname: raw.nickname }
  const next = writeLocalLobbyUser({
    uuid: raw.uuid,
    nickname: raw.nickname,
  })
  console.info('[lobbyUser] 本地无 uuid/nickname，已随机生成并写入 localStorage')
  return next
}

function readRawLocalUsers(): LobbyUserAccount[] {
  try {
    const raw = localStorage.getItem(LS_MULTI_USERS_KEY)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const rec = item as Record<string, unknown>
        return {
          uuid: nonempty(rec.uuid),
          nickname: nonempty(rec.nickname),
        }
      })
      .filter((item): item is LobbyUserAccount => item !== null)
  } catch {
    return []
  }
}

export function writeRawLocalUsers(accounts: LobbyUserAccount[]): void {
  try {
    localStorage.setItem(LS_MULTI_USERS_KEY, JSON.stringify(accounts))
  } catch (err) {
    console.warn('[writeRawLocalUsers] 写入失败', err)
  }
}

/**
 * 保证前 count 个账号均具备非空且互不重复的 uuid 与 nickname
 */
export function deduplicateLobbyAccounts(
  source: LobbyUserAccount[],
  count: number,
): LobbyUserAccount[] {
  const targetLen = Math.max(count, source.length, DEFAULT_MULTI_TAB_COUNT)
  const usedUuids = new Set<string>()
  const usedNicknames = new Set<string>()
  const result: LobbyUserAccount[] = []

  for (let i = 0; i < targetLen; i += 1) {
    const rawUuid = nonempty(source[i]?.uuid)
    const rawNick = nonempty(source[i]?.nickname)

    const uuid =
      rawUuid && !usedUuids.has(rawUuid) ? rawUuid : generateLobbyUuid(usedUuids)
    usedUuids.add(uuid)

    const nickname =
      rawNick && !usedNicknames.has(rawNick)
        ? rawNick
        : generateLobbyNickname(usedNicknames)
    usedNicknames.add(nickname)

    result.push({ uuid, nickname })
  }
  return result
}

/**
 * 读取并确保本机拥有至少 count 个不重复的大厅用户账号（第 1 个账号与单用户 jumpl.lobbyUser 同步）
 */
export function ensureLocalLobbyUsers(count = MAX_MULTI_TAB_COUNT): LobbyUserAccount[] {
  const primary = ensureLocalLobbyUser()
  const saved = readRawLocalUsers()
  if (saved.length === 0) {
    saved.push({ uuid: primary.uuid, nickname: primary.nickname })
  } else {
    saved[0] = {
      uuid: nonempty(saved[0]?.uuid) || primary.uuid,
      nickname: nonempty(saved[0]?.nickname) || primary.nickname,
    }
  }
  const normalized = deduplicateLobbyAccounts(saved, Math.max(count, MAX_MULTI_TAB_COUNT))
  writeRawLocalUsers(normalized)
  return normalized
}

/**
 * 重新随机指定索引账号的 uuid 或 nickname（确保与其他账号均不重复）
 */
export function regenerateAccountField(
  accounts: LobbyUserAccount[],
  index: number,
  field: 'uuid' | 'nickname',
): LobbyUserAccount[] {
  const next = accounts.map((a) => ({ ...a }))
  while (next.length <= index) {
    next.push({ uuid: '', nickname: '' })
  }
  if (field === 'uuid') {
    const used = new Set(next.map((a, idx) => (idx === index ? '' : a.uuid)).filter(Boolean))
    next[index]!.uuid = generateLobbyUuid(used)
  } else {
    const used = new Set(next.map((a, idx) => (idx === index ? '' : a.nickname)).filter(Boolean))
    next[index]!.nickname = generateLobbyNickname(used)
  }
  writeRawLocalUsers(next)
  if (index === 0 && next[0]) {
    writeLocalLobbyUser(next[0])
  }
  return next
}

/**
 * 一键重新随机生成全部 count 个互不重复的账号
 */
export function regenerateAllAccounts(count = MAX_MULTI_TAB_COUNT): LobbyUserAccount[] {
  const fresh = deduplicateLobbyAccounts([], Math.max(count, MAX_MULTI_TAB_COUNT))
  writeRawLocalUsers(fresh)
  if (fresh[0]) {
    writeLocalLobbyUser(fresh[0])
  }
  return fresh
}

/** 写入 JUMP_LOBBY / 导出时去掉本机身份，避免串到其他设备 */
export function lobbyForSharedStore(lobby: LobbyConfig): LobbyConfig {
  const copy: LobbyConfig = {
    ...lobby,
    uuid: '',
    nickname: '',
    multiTabCount: clampMultiTabCount(lobby.multiTabCount),
  }
  delete copy.accounts
  return copy
}

/** 与 deploy_lobby defaultConfig 对齐的默认大厅参数 */
export function createDefaultLobbyConfig(): LobbyConfig {
  const user = ensureLocalLobbyUser()
  const accounts = ensureLocalLobbyUsers(MAX_MULTI_TAB_COUNT)
  return {
    api_protocol: 'https',
    redirect_protocol: 'http',
    server: 'gws-westpool.ht666.xyz',
    appKey: '7bf1c9cf708e840cd0d91458db62fd8d',
    path: '/api/v1/game/login',
    uuid: user.uuid,
    nickname: user.nickname,
    multiTabCount: DEFAULT_MULTI_TAB_COUNT,
    accounts,
    session: 'TEST',
    channel_id: 1,
    merchant_id: 1,
    game_id: 12000,
    game_redirect: 'wlzbjs.ht666.xyz',
  }
}

export function createLobbyJumpItem(): {
  item: {
    id: string
    kind: 'lobby'
    openMode: OpenMode
    name: string
    iconUrl: string
    url: string
    args: Record<string, string>
  }
  lobby: LobbyConfig
} {
  return {
    item: {
      id: createId(),
      kind: 'lobby',
      openMode: 'tab',
      name: '大厅跳转',
      iconUrl: '',
      url: '',
      args: {},
    },
    lobby: createDefaultLobbyConfig(),
  }
}

function flattenParams(
  obj: unknown,
  prefix = '',
): Record<string, string> {
  if (obj === null || obj === undefined) return {}
  if (typeof obj !== 'object') {
    return { [prefix]: String(obj) }
  }
  return Object.entries(obj as Record<string, unknown>).reduce(
    (acc, [k, v]) => {
      const key = prefix ? `${prefix}[${k}]` : k
      return { ...acc, ...flattenParams(v, key) }
    },
    {} as Record<string, string>,
  )
}

/** 与 deploy_lobby generateSign 一致：HMAC-SHA256(path?sortedQuery, appKey) → hex */
export function generateSign(
  path: string,
  params: Record<string, unknown>,
  appKey: string,
): string {
  const flat = flattenParams(params)
  const query = Object.keys(flat)
    .sort()
    .map((k) => `${k}=${flat[k]}`)
    .join('&')
  const signStr = `${path}?${query}`
  return CryptoJS.HmacSHA256(signStr, appKey).toString(CryptoJS.enc.Hex)
}

export function parseLobbyConfig(raw: unknown): LobbyConfig {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error('大厅配置须为对象')
  }
  const obj = raw as Record<string, unknown>
  const base = createDefaultLobbyConfig()
  const user = ensureLocalLobbyUser()
  const accounts = ensureLocalLobbyUsers(MAX_MULTI_TAB_COUNT)
  const api =
    obj.api_protocol === 'http' || obj.api_protocol === 'https'
      ? obj.api_protocol
      : base.api_protocol
  const redirect =
    obj.redirect_protocol === 'http' || obj.redirect_protocol === 'https'
      ? obj.redirect_protocol
      : base.redirect_protocol

  return {
    api_protocol: api,
    redirect_protocol: redirect,
    server: typeof obj.server === 'string' ? obj.server : base.server,
    appKey: typeof obj.appKey === 'string' ? obj.appKey : base.appKey,
    path: typeof obj.path === 'string' ? obj.path : base.path,
    uuid: user.uuid,
    nickname: user.nickname,
    multiTabCount: clampMultiTabCount(obj.multiTabCount),
    accounts,
    session: typeof obj.session === 'string' ? obj.session : base.session,
    channel_id:
      typeof obj.channel_id === 'number' && Number.isFinite(obj.channel_id)
        ? obj.channel_id
        : Number(obj.channel_id) || base.channel_id,
    merchant_id:
      typeof obj.merchant_id === 'number' && Number.isFinite(obj.merchant_id)
        ? obj.merchant_id
        : Number(obj.merchant_id) || base.merchant_id,
    game_id:
      typeof obj.game_id === 'number' && Number.isFinite(obj.game_id)
        ? obj.game_id
        : Number(obj.game_id) || base.game_id,
    game_redirect:
      typeof obj.game_redirect === 'string'
        ? obj.game_redirect
        : base.game_redirect,
  }
}

export type WindowGridRect = {
  left: number
  top: number
  width: number
  height: number
}

/**
 * 针对 Chrome / Edge 计算 N 个独立窗口在屏幕可用工作区上的均匀网格排列坐标
 * - N=2: 1行 × 2列（左右对半分屏）
 * - N=3: 1行 × 3列（左中右三等分）
 * - N=4: 2行 × 2列（田字格四等分）
 * - N=5..6: 2行 × 3列
 * - N=7..9: 3行 × 3列
 * - N=10..12: 3行 × 4列
 */
export function computeChromeGridRects(count: number): WindowGridRect[] {
  const total = clampMultiTabCount(count)
  const scr = (typeof window !== 'undefined' ? window.screen : undefined) as
    | (Screen & { availLeft?: number; availTop?: number })
    | undefined
  const availLeft = typeof scr?.availLeft === 'number' ? scr.availLeft : 0
  const availTop = typeof scr?.availTop === 'number' ? scr.availTop : 0
  const availWidth = Math.max(800, scr?.availWidth || scr?.width || 1440)
  const availHeight = Math.max(600, scr?.availHeight || scr?.height || 900)

  let cols = 2
  let rows = 1
  if (total <= 1) {
    cols = 1
    rows = 1
  } else if (total === 2) {
    cols = 2
    rows = 1
  } else if (total === 3) {
    cols = 3
    rows = 1
  } else {
    cols = Math.ceil(Math.sqrt(total))
    rows = Math.ceil(total / cols)
  }

  const cellW = Math.max(220, Math.floor(availWidth / cols))
  const cellH = Math.max(220, Math.floor(availHeight / rows))

  const rects: WindowGridRect[] = []
  for (let i = 0; i < total; i += 1) {
    const r = Math.floor(i / cols)
    const c = i % cols
    rects.push({
      left: Math.round(availLeft + c * cellW),
      top: Math.round(availTop + r * cellH),
      width: cellW,
      height: cellH,
    })
  }
  return rects
}

export type LobbyJumpResult = {
  finalUrl: string
}

/**
 * 大厅跳转：POST 登录 API → 用返回 game_url 的 query 拼到 game_redirect。
 * 算法对齐 deploy_lobby.html 点击逻辑。
 */
export async function executeLobbyJump(
  lobby: LobbyConfig,
): Promise<LobbyJumpResult> {
  const params = {
    channel_id: lobby.channel_id,
    merchant_id: lobby.merchant_id,
    game_id: lobby.game_id,
    uuid: lobby.uuid,
    nickname: lobby.nickname,
    session: lobby.session,
    timestamp: Math.floor(Date.now() / 1000),
    nonce: randomString(),
  }

  const sign = generateSign(lobby.path, params, lobby.appKey)
  const apiUrl = `${lobby.api_protocol}://${lobby.server}${lobby.path}`

  let data: unknown
  try {
    const res = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Sign: sign,
      },
      body: JSON.stringify(params),
    })
    data = await res.json()
  } catch (err) {
    const msg = err instanceof Error ? err.message : '网络错误'
    throw new Error(`大厅登录请求失败：${msg}`)
  }

  if (typeof data !== 'object' || data === null) {
    throw new Error('大厅登录返回无效')
  }
  const body = data as {
    success?: unknown
    data?: { game_url?: unknown }
  }
  if (!body.success || typeof body.data?.game_url !== 'string') {
    throw new Error('大厅登录失败：未返回 game_url')
  }

  const gameUrl = new URL(body.data.game_url)
  const redirectBase = String(lobby.game_redirect || '').includes('://')
    ? lobby.game_redirect
    : `${lobby.redirect_protocol}://${lobby.game_redirect}`
  const finalUrl = `${redirectBase}?${gameUrl.searchParams.toString()}`
  return { finalUrl }
}
