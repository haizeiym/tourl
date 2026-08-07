import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_FILE = path.join(ROOT, 'data', 'jump-config.json')
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
    'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    ...extraHeaders,
  })
  res.end(data)
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
        'Access-Control-Allow-Methods': 'GET,PUT,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      })
      res.end()
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
