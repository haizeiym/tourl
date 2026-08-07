/**
 * 构建前：确保存在「全员共用」的云端配置地址，写入 public/data/cloud-url.txt
 * 这样打包上传后，所有人打开同一站点读到同一份配置。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const SEED = path.join(ROOT, 'data', 'jump-config.json')
const OUT = path.join(ROOT, 'public', 'data', 'cloud-url.txt')
const STATE = path.join(ROOT, 'data', 'cloud-url.txt')

function readExistingUrl(file) {
  if (!fs.existsSync(file)) return ''
  const line = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#') && /^https?:\/\//i.test(l))
  return line || ''
}

function writeUrl(url) {
  const body = `${url}\n`
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.mkdirSync(path.dirname(STATE), { recursive: true })
  fs.writeFileSync(OUT, body, 'utf8')
  fs.writeFileSync(STATE, body, 'utf8')
}

async function createBlob(seed) {
  const res = await fetch('https://jsonblob.com/api/jsonBlob', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(seed),
  })
  if (!res.ok) throw new Error(`创建失败 HTTP ${res.status}`)
  const loc = res.headers.get('Location') || res.headers.get('location')
  if (!loc) throw new Error('创建失败：无 Location')
  return loc.startsWith('http') ? loc : `https://jsonblob.com${loc}`
}

async function putBlob(url, seed) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(seed),
  })
  if (!res.ok) {
    console.warn(`[prepare-shared-cloud] 同步种子失败 HTTP ${res.status}`)
  }
}

async function main() {
  if (process.env.SKIP_CLOUD === '1') {
    console.warn('[prepare-shared-cloud] SKIP_CLOUD=1：跳过。多人将无法共享写入。')
    return
  }

  const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'))
  let url = readExistingUrl(STATE) || readExistingUrl(OUT)

  if (!url) {
    console.log('[prepare-shared-cloud] 创建全员共用云端配置…')
    url = await createBlob(seed)
    console.log(`[prepare-shared-cloud] ${url}`)
  } else {
    console.log(`[prepare-shared-cloud] 复用已有云端并同步种子：${url}`)
    await putBlob(url, seed)
  }

  writeUrl(url)
  console.log(`[prepare-shared-cloud] 已写入 public/data/cloud-url.txt`)
}

main().catch((err) => {
  console.error('[prepare-shared-cloud]', err)
  process.exit(1)
})
