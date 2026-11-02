import http from 'node:http'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function getLanIp() {
  try {
    const nets = os.networkInterfaces()
    for (const list of Object.values(nets)) {
      if (!list) continue
      for (const net of list) {
        if (net.family === 'IPv4' && !net.internal && net.address) {
          return net.address
        }
      }
    }
  } catch {
    /* ignore */
  }
  return '127.0.0.1'
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DATA_FILE = path.join(ROOT, 'data', 'jump-config.json')
const LOBBY_DIR = path.join(ROOT, 'data', 'lobby')
const BACKUP_DIR = path.join(ROOT, 'data', 'backup')
const BACKUP_CONFIG = path.join(BACKUP_DIR, 'jump-config.json')
const BACKUP_LOBBY_DIR = path.join(BACKUP_DIR, 'lobby')
const LAYOUT_DIR = path.join(ROOT, 'data', 'layout')
const SCREENSHOT_DIR = path.join(ROOT, 'data', 'screenshots')
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

    const fileMatch = url.pathname.match(/^\/(?:api\/)?screenshot\/file\/([a-zA-Z0-9._-]+)$/)
    if (fileMatch && method === 'GET') {
      const filename = fileMatch[1]
      const filePath = path.join(SCREENSHOT_DIR, filename)
      try {
        const data = await fs.readFile(filePath)
        const ext = path.extname(filename).toLowerCase()
        const mime =
          ext === '.webm'
            ? 'video/webm'
            : ext === '.mp4'
              ? 'video/mp4'
              : 'image/png'
        res.writeHead(200, {
          'Content-Type': mime,
          'Content-Length': data.byteLength,
          'Access-Control-Allow-Origin': '*',
        })
        res.end(data)
      } catch {
        sendJson(res, 404, { error: '文件不存在' })
      }
      return
    }

    if ((url.pathname === '/api/screenshot/email' || url.pathname === '/screenshot/email') && method === 'POST') {
      const body = await readBody(req)
      const to = (typeof body?.to === 'string' ? body.to.trim() : '') || 'gcdxdy666@gmail.com'
      const imageDataUrl = typeof body?.imageDataUrl === 'string' ? body.imageDataUrl : ''
      const pageUrl = typeof body?.pageUrl === 'string' ? body.pageUrl : ''
      const content = typeof body?.content === 'string' ? body.content.trim() : ''
      const b64Marker = ';base64,'
      const b64Idx = imageDataUrl.indexOf(b64Marker)
      const header = b64Idx > 0 ? imageDataUrl.slice(0, b64Idx) : ''
      if (b64Idx === -1 || (!header.startsWith('data:image/') && !header.startsWith('data:video/'))) {
        sendJson(res, 400, { error: '媒体数据格式无效（需为图片或视频 base64）' })
        return
      }
      const mimeType = header.slice(5).split(';')[0] || 'image/png'
      const isVideo = mimeType.startsWith('video/')
      const subject =
        typeof body?.subject === 'string' && body.subject.trim()
          ? body.subject.trim()
          : `${isVideo ? '网页录屏' : '网页截图'} (${new Date().toISOString().slice(0, 19).replace('T', ' ')})`

      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
        sendJson(res, 400, { error: '请填写有效的收件邮箱地址' })
        return
      }
      const base64Content = imageDataUrl.slice(b64Idx + b64Marker.length)
      if (!base64Content) {
        sendJson(res, 400, { error: '媒体数据为空' })
        return
      }
      const buf = Buffer.from(base64Content, 'base64')
      if (buf.byteLength > 30 * 1024 * 1024) {
        sendJson(res, 400, { error: '媒体文件大小超过 30MB 上限' })
        return
      }

      await fs.mkdir(SCREENSHOT_DIR, { recursive: true })
      const stamp = Date.now()
      const ext = isVideo ? (mimeType.includes('mp4') ? 'mp4' : 'webm') : 'png'
      const prefix = isVideo ? 'recording' : 'screenshot'
      const mediaFilename = `${prefix}-${stamp}.${ext}`
      const pngPath = path.join(SCREENSHOT_DIR, mediaFilename)
      const metaPath = path.join(SCREENSHOT_DIR, `${prefix}-${stamp}.json`)
      await fs.writeFile(pngPath, buf)

      const lanIp = getLanIp()
      const localFileUrl = `http://${lanIp}:${PORT}/api/screenshot/file/${mediaFilename}`
      let publicFileUrl = ''
      const uaHeaders = {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
      }

      if (isVideo) {
        const videoBlob = new Blob([buf], { type: mimeType })
        // 1. 尝试 tmpfiles.org
        try {
          const fd = new FormData()
          fd.append('file', videoBlob, mediaFilename)
          const upRes = await fetch('https://tmpfiles.org/api/v1/upload', {
            method: 'POST',
            headers: uaHeaders,
            body: fd,
            signal: AbortSignal.timeout(8000),
          })
          if (upRes.ok) {
            const j = await upRes.json()
            const rawUrl = typeof j?.data?.url === 'string' ? j.data.url : ''
            if (rawUrl) {
              publicFileUrl = rawUrl.replace('://tmpfiles.org/', '://tmpfiles.org/dl/')
            }
          }
        } catch (err) {
          console.warn('[screenshot-email] tmpfiles upload skipped', err instanceof Error ? err.message : err)
        }
        // 2. 备选 uguu.se
        if (!publicFileUrl) {
          try {
            const fd = new FormData()
            fd.append('files[]', videoBlob, mediaFilename)
            const upRes = await fetch('https://uguu.se/upload', {
              method: 'POST',
              headers: uaHeaders,
              body: fd,
              signal: AbortSignal.timeout(8000),
            })
            if (upRes.ok) {
              const j = await upRes.json()
              const uUrl = j?.files?.[0]?.url
              if (typeof uUrl === 'string' && /^https?:\/\//i.test(uUrl)) {
                publicFileUrl = uUrl
              }
            }
          } catch (err) {
            console.warn('[screenshot-email] uguu upload skipped', err instanceof Error ? err.message : err)
          }
        }
        // 3. 备选 litterbox.catbox.moe
        if (!publicFileUrl) {
          try {
            const fd = new FormData()
            fd.append('reqtype', 'fileupload')
            fd.append('time', '72h')
            fd.append('fileToUpload', videoBlob, mediaFilename)
            const upRes = await fetch('https://litterbox.catbox.moe/resources/internals/api.php', {
              method: 'POST',
              headers: uaHeaders,
              body: fd,
              signal: AbortSignal.timeout(8000),
            })
            if (upRes.ok) {
              const text = (await upRes.text()).trim()
              if (/^https?:\/\//i.test(text)) publicFileUrl = text
            }
          } catch (err) {
            console.warn('[screenshot-email] litterbox upload skipped', err instanceof Error ? err.message : err)
          }
        }
      }

      if (!publicFileUrl) {
        publicFileUrl = localFileUrl
      }

      await fs.writeFile(
        metaPath,
        JSON.stringify(
          {
            to,
            subject,
            content,
            pageUrl,
            mimeType,
            sizeBytes: buf.byteLength,
            maxBytes: body?.maxBytes,
            windowWidth: body?.windowWidth,
            windowHeight: body?.windowHeight,
            durationSec: body?.durationSec,
            publicFileUrl,
            localFileUrl,
            sentAt: stamp,
            file: mediaFilename,
          },
          null,
          2,
        ),
        'utf8',
      )

      const contentHtml = content ? `<p>邮件内容：${content}</p>` : ''
      const urlHtml = `<p>视频在线播放/下载链接 (publicFileUrl)：<a href="${publicFileUrl}">${publicFileUrl}</a></p>`
      const resendKey = process.env.RESEND_API_KEY
      const webhookUrl = process.env.EMAIL_WEBHOOK_URL
      if (resendKey) {
        const mailFrom = process.env.MAIL_FROM || 'Jumpl Screenshot <onboarding@resend.dev>'
        const canAttach = buf.byteLength <= 4_500_000
        let resp = null
        if (canAttach) {
          resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: mailFrom,
              to: [to],
              subject,
              html: `${contentHtml}<p>页面地址：${pageUrl || '未知'}</p>${isVideo ? urlHtml : ''}<p>${isVideo ? '录屏视频' : '截图'}见附件。</p>`,
              attachments: [{ filename: mediaFilename, content: base64Content }],
            }),
          }).catch(() => null)
        }
        // 如果视频发送不了，则发送 publicFileUrl 到邮箱
        if (!resp || !resp.ok) {
          resp = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${resendKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              from: mailFrom,
              to: [to],
              subject,
              html: `${contentHtml}<p>页面地址：${pageUrl || '未知'}</p>${urlHtml}`,
            }),
          })
        }
        if (!resp.ok) {
          const errText = await resp.text().catch(() => '')
          sendJson(res, 502, { error: `邮件服务返回错误 (${resp.status}) ${errText.slice(0, 120)}` })
          return
        }
        console.log(`[screenshot-email] sent via Resend to=${to} publicUrl=${publicFileUrl}`)
        sendJson(res, 200, {
          ok: true,
          mode: 'resend',
          publicFileUrl,
          fileUrl: publicFileUrl,
          localFileUrl,
          message: `${isVideo ? '录屏' : '截图'}已发送至 ${to}`,
        })
        return
      }

      if (webhookUrl) {
        let resp = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to,
            subject,
            content,
            pageUrl,
            publicFileUrl,
            imageDataUrl,
            filename: mediaFilename,
          }),
        }).catch(() => null)
        if (!resp || !resp.ok) {
          resp = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              to,
              subject,
              content,
              pageUrl,
              publicFileUrl,
              filename: mediaFilename,
            }),
          })
        }
        if (!resp.ok) {
          sendJson(res, 502, { error: `邮件 Webhook 返回错误 (${resp.status})` })
          return
        }
        console.log(`[screenshot-email] sent via webhook to=${to} publicUrl=${publicFileUrl}`)
        sendJson(res, 200, {
          ok: true,
          mode: 'webhook',
          publicFileUrl,
          fileUrl: publicFileUrl,
          localFileUrl,
          message: `${isVideo ? '录屏' : '截图'}已发送至 ${to}`,
        })
        return
      }

      console.log(`[screenshot-email] saved locally to=${to} file=${pngPath} publicUrl=${publicFileUrl}`)
      sendJson(res, 200, {
        ok: true,
        mode: 'local',
        publicFileUrl,
        fileUrl: publicFileUrl,
        localFileUrl,
        message: `已投递${isVideo ? '录屏' : '截图'}至 ${to}（本地开发已保存至 data/screenshots/${mediaFilename}）`,
      })
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

    const layoutMatch = url.pathname.match(/^\/(?:api\/)?layout\/(items|fields)\/?$/)
    if (layoutMatch) {
      const which = layoutMatch[1]
      const file = path.join(LAYOUT_DIR, `${which}.json`)
      if (method === 'GET') {
        try {
          const raw = JSON.parse(await fs.readFile(file, 'utf8'))
          sendJson(res, 200, raw)
        } catch (err) {
          if (err && typeof err === 'object' && 'code' in err && err.code === 'ENOENT') {
            sendJson(res, 200, {})
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
        await fs.mkdir(LAYOUT_DIR, { recursive: true })
        await fs.writeFile(file, JSON.stringify(body, null, 2), 'utf8')
        sendJson(res, 200, body)
        return
      }
      sendJson(res, 405, { error: 'Method Not Allowed' })
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
