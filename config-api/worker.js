/**
 * Jumpl 全局配置 API（Cloudflare Worker + KV）
 * 数据持久存在 KV，与前端发版无关；地址固定后勿再更换。
 *
 * 部署：
 *   1. npm i -g wrangler  或  npx wrangler
 *   2. npx wrangler login
 *   3. npx wrangler kv namespace create JUMP_CONFIG
 *      把输出的 id 填进 wrangler.toml
 *   4. npm run deploy:config-api
 *   5. 把 workers.dev 地址写入项目 data/cloud-url.txt（一行）
 *      例如：https://jumpl-config.xxx.workers.dev/config
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  Pragma: 'no-cache',
}

const KEY = 'jump-config'

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

const EMPTY = { updatedAt: 0, items: [] }

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS })
    }

    const { pathname } = new URL(request.url)
    if (pathname !== '/' && pathname !== '/config') {
      return json({ error: 'Not Found' }, 404)
    }

    try {
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
