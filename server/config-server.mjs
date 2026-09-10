import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_FILE = path.join(ROOT, 'data', 'jump-config.json')
const LOBBY_DIR = path.join(ROOT, 'data', 'lobby')
const BACKUP_DIR = path.join(ROOT, 'data', 'backup')
const BACKUP_CONFIG = path.join(BACKUP_DIR, 'jump-config.json')
const BACKUP_LOBBY_DIR = path.join(BACKUP_DIR, 'lobby')
const DIST_DIR = path.join(ROOT, 'dist')
const PORT = Number(process.env.PORT || 8787)
const SERVE_STATIC = process.env.SERVE_STATIC === '1'

const DEFAULT_CONFIG = {
  updatedAt: 0,
  items: [],
}

async function ensureDataFile() {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true })
  try {
    await fs.access(DATA_FILE)
  } catch {
    await fs.writeFile(DATA_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf8')
  }
}

async function readConfig() {
  const text = await fs.readFile(DATA_FILE, 'utf8')
  const raw = JSON.parse(text)
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.items)) {
    throw new Error('invalid config file')
  }
  return {
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    items: raw.items,
  }
}

async function writeConfig(config) {
  const tmp = `${DATA_FILE}.tmp`
  await fs.writeFile(tmp, JSON.stringify(config, null, 2), 'utf8')
  await fs.rename(tmp, DATA_FILE)
}

function sendJson(res, status, body, extraHeaders = {}) {
  const data = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    Pragma: 'no-cache',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  })
  res.end(data)
}

function lobbyFile(id) {
  const safe = String(id).replace(/[^a-zA-Z0-9._-]/g, '_')
  return path.join(LOBBY_DIR, `${safe}.json`)
}

async function readLobby(id) {
  const text = await fs.readFile(lobbyFile(id), 'utf8')
  return JSON.parse(text)
}

async function writeLobby(id, body) {
  await fs.mkdir(LOBBY_DIR, { recursive: true })
  const file = lobbyFile(id)
  const tmp = `${file}.tmp`
  await fs.writeFile(tmp, JSON.stringify(body, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

async function deleteLobby(id) {
  try {
    await fs.unlink(lobbyFile(id))
  } catch (err) {
    if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
      return
    }
    throw err
  }
}

function parseLobbyId(pathname) {
  const m = pathname.match(/^\/api\/lobby\/([^/]+)\/?$/)
  if (!m) return null
  try {
    return decodeURIComponent(m[1])
  } catch {
    return m[1]
  }
}

async function snapshotLocalBackup() {
  await fs.mkdir(BACKUP_LOBBY_DIR, { recursive: true })
  const config = await readConfig()
  await fs.writeFile(BACKUP_CONFIG, JSON.stringify(config, null, 2), 'utf8')

  let names = []
  try {
    names = await fs.readdir(LOBBY_DIR)
  } catch (err) {
    if (!(err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT')) {
      throw err
    }
  }

  const jsonFiles = names.filter((n) => n.endsWith('.json'))
  const destNames = await fs.readdir(BACKUP_LOBBY_DIR).catch(() => [])
  for (const n of destNames) {
    if (n.endsWith('.json') && !jsonFiles.includes(n)) {
      await fs.unlink(path.join(BACKUP_LOBBY_DIR, n))
    }
  }
  for (const n of jsonFiles) {
    const src = path.join(LOBBY_DIR, n)
    const dest = path.join(BACKUP_LOBBY_DIR, n)
    await fs.copyFile(src, dest)
  }

  const backedAt = Date.now()
  await fs.writeFile(
    path.join(BACKUP_DIR, 'meta.json'),
    JSON.stringify(
      { ok: true, backedAt, configKeys: 1, lobbyKeys: jsonFiles.length },
      null,
      2,
    ),
    'utf8',
  )
  return { ok: true, backedAt, configKeys: 1, lobbyKeys: jsonFiles.length }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8')
        resolve(raw ? JSON.parse(raw) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase()
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  }
  return map[ext] || 'application/octet-stream'
}

async function serveStatic(req, res) {
  const url = new URL(req.url || '/', `http://${req.headers.host}`)
  let pathname = decodeURIComponent(url.pathname)
  if (pathname === '/') pathname = '/index.html'
  const filePath = path.normalize(path.join(DIST_DIR, pathname))
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403).end('Forbidden')
    return
  }
  try {
    const data = await fs.readFile(filePath)
    res.writeHead(200, { 'Content-Type': contentType(filePath) })
    res.end(data)
  } catch {
    // SPA fallback
    try {
      const index = await fs.readFile(path.join(DIST_DIR, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(index)
    } catch {
      res.writeHead(404).end('Not Found')
    }
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)
    const method = req.method || 'GET'

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,PUT,POST,DELETE,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
      return
    }

    const lobbyId = parseLobbyId(url.pathname)
    if (lobbyId) {
      if (method === 'GET') {
        try {
          const lobby = await readLobby(lobbyId)
          sendJson(res, 200, lobby)
        } catch (err) {
          if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
            sendJson(res, 404, { error: '大厅配置不存在' })
            return
          }
          throw err
        }
        return
      }
      if (method === 'PUT') {
        const body = await readBody(req)
        if (!body || typeof body !== 'object') {
          sendJson(res, 400, { error: 'body 须为对象' })
          return
        }
        await writeLobby(lobbyId, body)
        console.log(`[lobby] saved id=${lobbyId}`)
        sendJson(res, 200, body)
        return
      }
      if (method === 'DELETE') {
        await deleteLobby(lobbyId)
        console.log(`[lobby] deleted id=${lobbyId}`)
        sendJson(res, 200, { ok: true })
        return
      }
      sendJson(res, 405, { error: 'Method Not Allowed' })
      return
    }

    if ((url.pathname === '/api/backup' || url.pathname === '/backup') && method === 'POST') {
      const result = await snapshotLocalBackup()
      console.log(`[backup] configKeys=${result.configKeys} lobbyKeys=${result.lobbyKeys}`)
      sendJson(res, 200, result)
      return
    }

    if ((url.pathname === '/api/lobbies' || url.pathname === '/lobbies') && method === 'GET') {
      await fs.mkdir(LOBBY_DIR, { recursive: true })
      let names = []
      try {
        names = await fs.readdir(LOBBY_DIR)
      } catch {
        names = []
      }
      const lobbies = {}
      for (const n of names) {
        if (!n.endsWith('.json')) continue
        const id = n.slice(0, -5)
        try {
          lobbies[id] = JSON.parse(await fs.readFile(path.join(LOBBY_DIR, n), 'utf8'))
        } catch {
          /* skip */
        }
      }
      sendJson(res, 200, { lobbies })
      return
    }

    if ((url.pathname === '/api/config' || url.pathname === '/api/config.php' || url.pathname === '/config.php') && method === 'GET') {
      const config = await readConfig()
      sendJson(res, 200, config)
      return
    }

    if ((url.pathname === '/api/config' || url.pathname === '/api/config.php' || url.pathname === '/config.php') && method === 'PUT') {
      const body = await readBody(req)
      if (!body || typeof body !== 'object' || !Array.isArray(body.items)) {
        sendJson(res, 400, { error: 'body 须包含 items 数组' })
        return
      }

      const current = await readConfig()
      const clientUpdatedAt =
        typeof body.updatedAt === 'number' ? body.updatedAt : 0
      const force = url.searchParams.get('force') === '1'

      if (!force && clientUpdatedAt !== current.updatedAt) {
        sendJson(res, 409, {
          error: '配置已被他人更新，请刷新后重试或强制覆盖',
          serverConfig: current,
        })
        return
      }

      const next = {
        updatedAt: Date.now(),
        items: body.items,
      }
      await writeConfig(next)
      console.log(`[config] saved updatedAt=${next.updatedAt} items=${next.items.length}`)
      sendJson(res, 200, next)
      return
    }

    if (SERVE_STATIC) {
      await serveStatic(req, res)
      return
    }

    sendJson(res, 404, { error: 'Not Found' })
  } catch (err) {
    console.error('[server]', err)
    sendJson(res, 500, {
      error: err instanceof Error ? err.message : 'Internal Server Error',
    })
  }
})

await ensureDataFile()

server.on('error', (err) => {
  if (err && typeof err === 'object' && 'code' in err && err.code === 'EADDRINUSE') {
    console.error(
      `[config-server] 端口 ${PORT} 已被占用。可执行: lsof -ti:${PORT} | xargs kill -9`,
    )
    process.exit(1)
  }
  throw err
})

server.listen(PORT, () => {
  console.log(`[config-server] http://127.0.0.1:${PORT}  data=${DATA_FILE}`)
  if (SERVE_STATIC) console.log(`[config-server] serving static from ${DIST_DIR}`)
})
