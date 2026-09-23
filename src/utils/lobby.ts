import CryptoJS from 'crypto-js'
import type { JumpKind, LobbyConfig, OpenMode } from '../types/jump'
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

export function generateLobbyUuid(): string {
  return randomString(9, 9)
}

export function generateLobbyNickname(): string {
  return NICKNAMES[Math.floor(Math.random() * NICKNAMES.length)]!
}

const LS_USER_KEY = 'jumpl.lobbyUser'

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

/** 写入 JUMP_LOBBY / 导出时去掉本机身份，避免串到其他设备 */
export function lobbyForSharedStore(lobby: LobbyConfig): LobbyConfig {
  return { ...lobby, uuid: '', nickname: '' }
}

/** 与 deploy_lobby defaultConfig 对齐的默认大厅参数 */
export function createDefaultLobbyConfig(): LobbyConfig {
  const user = ensureLocalLobbyUser()
  return {
    api_protocol: 'https',
    redirect_protocol: 'http',
    server: 'gws-westpool.ht666.xyz',
    appKey: '7bf1c9cf708e840cd0d91458db62fd8d',
    path: '/api/v1/game/login',
    uuid: user.uuid,
    nickname: user.nickname,
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
