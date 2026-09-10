/**
 * Jumpl 全局配置 API（Cloudflare Worker + KV）
 * - JUMP_CONFIG：跳转列表
 * - JUMP_LOBBY：大厅参数
 * - JUMP_CONFIG_BACKUP / JUMP_LOBBY_BACKUP：点击「备份」时的快照（独立 namespace）
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

/** 把 src 全量快照到 dest（覆盖同名 key，删除 dest 中多余 key） */
async function snapshotKv(src, dest) {
  if (!src || !dest) {
    throw new Error('备份 KV 未绑定')
  }
  const srcKeys = await listAllKeys(src)
  const destKeys = await listAllKeys(dest)
  const srcSet = new Set(srcKeys)
  for (const name of srcKeys) {
    const val = await src.get(name)
    if (val !== null) await dest.put(name, val)
  }
  for (const name of destKeys) {
    if (!srcSet.has(name)) await dest.delete(name)
  }
  return srcKeys.length
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const { pathname } = new URL(request.url)

    try {
      if (pathname === '/backup' || pathname === '/backup/') {
        if (request.method !== 'POST') {
          return json({ error: 'Method Not Allowed' }, 405)
        }
        const configKeys = await snapshotKv(env.JUMP_CONFIG, env.JUMP_CONFIG_BACKUP)
        const lobbyKeys = await snapshotKv(env.JUMP_LOBBY, env.JUMP_LOBBY_BACKUP)
        return json({
          ok: true,
          backedAt: Date.now(),
          configKeys,
          lobbyKeys,
        })
      }

      const lobbyId = parseLobbyId(pathname)
      if (lobbyId) {
        const lobbyKv = env.JUMP_LOBBY
        if (!lobbyKv) {
          return json({ error: '未绑定 JUMP_LOBBY KV' }, 500)
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
        const raw = await env.JUMP_CONFIG.get(KEY)
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

        const force = new URL(request.url).searchParams.get('force') === '1'
        const currentRaw = await env.JUMP_CONFIG.get(KEY)
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
        await env.JUMP_CONFIG.put(KEY, JSON.stringify(next))
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
