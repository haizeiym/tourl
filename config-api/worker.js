/**
 * Jumpl 全局配置 API（Cloudflare Worker + KV）
 * - JUMP_CONFIG：跳转列表
 * - JUMP_LOBBY：大厅参数
 * - JUMP_CONFIG_BACKUP / JUMP_LOBBY_BACKUP：点击「备份」时的快照（独立 namespace）
 * - JUMP_ITEM_LAYOUT / JUMP_FIELD_LAYOUT：Grid/按钮顺序 与 属性面板字段顺序
 *
 * 查询参数 `kv` 为空时绑定名不变。`kv=beta` 时改为
 * JUMP_CONFIG_beta、JUMP_LOBBY_beta 等（由 `npm run pack -- beta` 创建并绑定）。
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
}

const KEY = 'jump-config'
const LOBBY_PREFIX = 'lobby:'
const KV_PROFILE_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/

function bindingName(base, profile) {
  return profile ? `${base}_${profile}` : base
}

/** @returns {string | null} 空字符串=默认库；null=参数非法 */
function readKvProfile(url) {
  const raw = (url.searchParams.get('kv') || '').trim()
  if (!raw) return ''
  if (!KV_PROFILE_RE.test(raw)) return null
  return raw
}

function pickNs(env, base, profile) {
  const name = bindingName(base, profile)
  return { name, ns: env[name] ?? null }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

const EMPTY = { updatedAt: 0, items: [] }

function lobbyKey(id) {
  return `${LOBBY_PREFIX}${id}`
}

function parseLobbyId(pathname) {
  const m = pathname.match(/^\/lobby\/([^/]+)\/?$/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

async function listAllKeys(ns) {
  const names = []
  let cursor
  do {
    const page = await ns.list(cursor ? { cursor, limit: 1000 } : { limit: 1000 })
    for (const k of page.keys) names.push(k.name)
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)
  return names
}

async function lobbyKeysFromConfig(configKv) {
  if (!configKv) return []
  const raw = await configKv.get(KEY)
  if (!raw) return []
  try {
    const cfg = JSON.parse(raw)
    const items = Array.isArray(cfg.items) ? cfg.items : []
    return items
      .filter((i) => i && i.kind === 'lobby' && typeof i.id === 'string' && i.id)
      .map((i) => lobbyKey(i.id))
  } catch {
    return []
  }
}

/** 把 src 全量快照到 dest（覆盖同名 key，删除 dest 中多余 key） */
async function snapshotKv(src, dest, extraKeys = []) {
  if (!src || !dest) {
    throw new Error('备份 KV 未绑定')
  }
  const srcKeys = await listAllKeys(src)
  for (const k of extraKeys) {
    if (k && !srcKeys.includes(k)) srcKeys.push(k)
  }
  const destKeys = await listAllKeys(dest)
  const srcSet = new Set(srcKeys)
  let copied = 0
  for (const name of srcKeys) {
    const val = await src.get(name)
    if (val === null) continue
    await dest.put(name, val)
    copied += 1
  }
  for (const name of destKeys) {
    if (!srcSet.has(name)) await dest.delete(name)
  }
  return copied
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const url = new URL(request.url)
    const { pathname } = url
    const profile = readKvProfile(url)
    if (profile === null) {
      return json({ error: '无效的 kv 参数' }, 400)
    }
    const configStore = pickNs(env, 'JUMP_CONFIG', profile)
    const lobbyStore = pickNs(env, 'JUMP_LOBBY', profile)
    const configBackupStore = pickNs(env, 'JUMP_CONFIG_BACKUP', profile)
    const lobbyBackupStore = pickNs(env, 'JUMP_LOBBY_BACKUP', profile)
    const itemLayoutStore = pickNs(env, 'JUMP_ITEM_LAYOUT', profile)
    const fieldLayoutStore = pickNs(env, 'JUMP_FIELD_LAYOUT', profile)

    try {
      if (pathname === '/lobbies' || pathname === '/lobbies/') {
        if (request.method !== 'GET') {
          return json({ error: 'Method Not Allowed' }, 405)
        }
        const lobbyKv = lobbyStore.ns
        if (!lobbyKv) {
          return json({ error: `未绑定 ${lobbyStore.name} KV` }, 500)
        }
        const names = await listAllKeys(lobbyKv)
        const lobbies = {}
        for (const name of names) {
          const id = name.startsWith(LOBBY_PREFIX)
            ? name.slice(LOBBY_PREFIX.length)
            : name
          const raw = await lobbyKv.get(name)
          if (!raw) continue
          try {
            lobbies[id] = JSON.parse(raw)
          } catch {
            /* skip corrupt */
          }
        }
        return json({ lobbies })
      }

      if (pathname === '/backup' || pathname === '/backup/') {
        if (request.method !== 'POST') {
          return json({ error: 'Method Not Allowed' }, 405)
        }
        const configKeys = await snapshotKv(configStore.ns, configBackupStore.ns, [KEY])
        const lobbyKeys = await snapshotKv(
          lobbyStore.ns,
          lobbyBackupStore.ns,
          await lobbyKeysFromConfig(configStore.ns),
        )
        return json({
          ok: true,
          backedAt: Date.now(),
          configKeys,
          lobbyKeys,
        })
      }

      const layoutMatch = pathname.match(/^\/layout\/(items|fields)\/?$/)
      if (layoutMatch) {
        const which = layoutMatch[1]
        const layoutStore = which === 'items' ? itemLayoutStore : fieldLayoutStore
        const ns = layoutStore.ns
        if (!ns) {
          return json({ error: `未绑定 ${layoutStore.name} KV` }, 500)
        }
        if (request.method === 'GET') {
          const raw = await ns.get('layout')
          if (!raw) return json({})
          try {
            return json(JSON.parse(raw))
          } catch {
            return json({ error: '布局损坏' }, 500)
          }
        }
        if (request.method === 'PUT') {
          const body = await request.json()
          if (!body || typeof body !== 'object') {
            return json({ error: 'body 须为对象' }, 400)
          }
          await ns.put('layout', JSON.stringify(body))
          return json(body)
        }
        return json({ error: 'Method Not Allowed' }, 405)
      }

      const lobbyId = parseLobbyId(pathname)
      if (lobbyId) {
        const lobbyKv = lobbyStore.ns
        if (!lobbyKv) {
          return json({ error: `未绑定 ${lobbyStore.name} KV` }, 500)
        }
        if (request.method === 'GET') {
          const raw = await lobbyKv.get(lobbyKey(lobbyId))
          if (!raw) return json({ error: '大厅配置不存在' }, 404)
          try {
            return json(JSON.parse(raw))
          } catch {
            return json({ error: '大厅配置损坏' }, 500)
          }
        }

        if (request.method === 'PUT') {
          const body = await request.json()
          if (!body || typeof body !== 'object') {
            return json({ error: 'body 须为对象' }, 400)
          }
          await lobbyKv.put(lobbyKey(lobbyId), JSON.stringify(body))
          return json(body)
        }

        if (request.method === 'DELETE') {
          await lobbyKv.delete(lobbyKey(lobbyId))
          return json({ ok: true })
        }

        return json({ error: 'Method Not Allowed' }, 405)
      }

      if (pathname !== '/' && pathname !== '/config') {
        return json({ error: 'Not Found' }, 404)
      }

      if (request.method === 'GET') {
        if (!configStore.ns) {
          return json({ error: `未绑定 ${configStore.name} KV` }, 500)
        }
        const raw = await configStore.ns.get(KEY)
        if (!raw) return json(EMPTY)
        try {
          return json(JSON.parse(raw))
        } catch {
          return json({ error: '配置损坏' }, 500)
        }
      }

      if (request.method === 'PUT') {
        const body = await request.json()
        if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
          return json({ error: 'body 须包含 items 数组' }, 400)
        }

        if (!configStore.ns) {
          return json({ error: `未绑定 ${configStore.name} KV` }, 500)
        }
        const force = url.searchParams.get('force') === '1'
        const currentRaw = await configStore.ns.get(KEY)
        const current = currentRaw ? JSON.parse(currentRaw) : EMPTY
        const clientUpdatedAt =
          typeof body.updatedAt === 'number' ? body.updatedAt : 0

        if (!force && clientUpdatedAt !== (current.updatedAt || 0)) {
          return json(
            {
              error: '配置已被他人更新，请刷新后重试或强制覆盖',
              serverConfig: current,
            },
            409,
          )
        }

        const next = {
          updatedAt: Date.now(),
          items: body.items,
        }
        await configStore.ns.put(KEY, JSON.stringify(next))
        return json(next)
      }

      return json({ error: 'Method Not Allowed' }, 405)
    } catch (err) {
      return json(
        { error: err instanceof Error ? err.message : 'Internal Error' },
        500,
      )
    }
  },
}
