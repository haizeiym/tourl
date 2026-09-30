/**
 * npm run pack           → 默认包，读写 JUMP_CONFIG / JUMP_LOBBY / …
 * npm run pack -- beta   → 创建并绑定 JUMP_*_beta，部署 Worker，包内请求带 ?kv=beta
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const configApi = join(root, 'config-api')
const tomlPath = join(configApi, 'wrangler.toml')

const BASES = [
  'JUMP_CONFIG',
  'JUMP_LOBBY',
  'JUMP_CONFIG_BACKUP',
  'JUMP_LOBBY_BACKUP',
  'JUMP_ITEM_LAYOUT',
  'JUMP_FIELD_LAYOUT',
]

const PROFILE_RE = /^[A-Za-z][A-Za-z0-9_]{0,31}$/

const profile = (process.argv[2] ?? '').trim()
if (process.argv.length > 3 || (profile && !PROFILE_RE.test(profile))) {
  console.error(
    '用法: npm run pack [-- <名称>]\n名称须以字母开头，只含字母、数字、下划线，最长 32 位。例如: npm run pack -- beta',
  )
  process.exit(1)
}

function capture(cmd) {
  return execSync(cmd, {
    cwd: configApi,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function parseNamespaceList(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end <= start) return []
  try {
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return []
    return arr
      .map((item) => {
        if (!item || typeof item !== 'object') return null
        const title =
          typeof item.title === 'string'
            ? item.title
            : typeof item.name === 'string'
              ? item.name
              : ''
        const id = typeof item.id === 'string' ? item.id : ''
        if (!title || !id) return null
        return { title, id }
      })
      .filter((item) => item !== null)
  } catch (err) {
    console.error('[pack] 解析 KV 列表失败', err instanceof Error ? err.message : err)
    return []
  }
}

function parseCreatedId(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1))
      if (typeof obj.id === 'string' && obj.id) return obj.id
      const nested = obj.kv_namespaces
      if (Array.isArray(nested) && typeof nested[0]?.id === 'string') return nested[0].id
    } catch {
      /* 继续用文本匹配 */
    }
  }
  const patterns = [
    /"id"\s*:\s*"([a-f0-9]+)"/i,
    /id\s*=\s*"([a-f0-9]+)"/i,
    /\bid\s*:\s*"?([a-f0-9]{16,})"?/i,
  ]
  for (const re of patterns) {
    const matched = text.match(re)
    if (matched?.[1]) return matched[1]
  }
  return null
}

function listNamespaces() {
  const text = capture('npx wrangler kv namespace list')
  return parseNamespaceList(text)
}

function createNamespace(title) {
  let text = ''
  try {
    text = capture(`npx wrangler kv namespace create ${title}`)
  } catch (err) {
    const stdout = err && typeof err === 'object' && 'stdout' in err ? String(err.stdout ?? '') : ''
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr ?? '') : ''
    text = `${stdout}\n${stderr}`
    const id = parseCreatedId(text)
    if (id) return id
    const again = listNamespaces().find((item) => item.title === title)
    if (again) return again.id
    console.error(text)
    throw new Error(`创建 KV ${title} 失败`)
  }
  const id = parseCreatedId(text)
  if (id) return id
  const again = listNamespaces().find((item) => item.title === title)
  if (again) return again.id
  console.error(text)
  throw new Error(`创建 KV ${title} 后未解析到 id`)
}

function upsertBindings(toml, entries) {
  let text = toml.endsWith('\n') ? toml : `${toml}\n`
  for (const { binding, id } of entries) {
    const marker = `binding = "${binding}"`
    const idx = text.indexOf(marker)
    if (idx === -1) {
      text += `\n[[kv_namespaces]]\nbinding = "${binding}"\nid = "${id}"\n`
      continue
    }
    const after = text.slice(idx)
    const idMatch = after.match(/id = "[^"]*"/)
    if (!idMatch || idMatch.index === undefined) {
      throw new Error(`wrangler.toml 中 ${binding} 缺少 id`)
    }
    const abs = idx + idMatch.index
    text = `${text.slice(0, abs)}id = "${id}"${text.slice(abs + idMatch[0].length)}`
  }
  return text
}

function ensureProfileNamespaces(name) {
  let existing
  try {
    existing = listNamespaces()
  } catch (err) {
    const stdout = err && typeof err === 'object' && 'stdout' in err ? String(err.stdout ?? '') : ''
    const stderr = err && typeof err === 'object' && 'stderr' in err ? String(err.stderr ?? '') : ''
    console.error(stdout)
    console.error(stderr)
    throw new Error('列出 KV 失败。请先在 config-api 目录执行 npx wrangler login')
  }

  const entries = []
  for (const base of BASES) {
    const title = `${base}_${name}`
    const found = existing.find((item) => item.title === title)
    if (found) {
      console.log(`[pack] 复用已有 ${title} (${found.id})`)
      entries.push({ binding: title, id: found.id })
      continue
    }
    console.log(`[pack] 创建 ${title}`)
    const id = createNamespace(title)
    console.log(`[pack] 已创建 ${title} (${id})`)
    entries.push({ binding: title, id })
  }

  const next = upsertBindings(readFileSync(tomlPath, 'utf8'), entries)
  writeFileSync(tomlPath, next)
  console.log('[pack] 已写入 config-api/wrangler.toml，开始部署 Worker')
  execSync('npx wrangler deploy', { cwd: configApi, stdio: 'inherit' })
}

if (profile) {
  try {
    ensureProfileNamespaces(profile)
  } catch (err) {
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  }
}

const buildEnv = { ...process.env }
if (profile) buildEnv.VITE_KV_PROFILE = profile
else delete buildEnv.VITE_KV_PROFILE

execSync('npm run build', { cwd: root, stdio: 'inherit', env: buildEnv })

const zipName = profile ? `jumpl-dist-${profile}.zip` : 'jumpl-dist.zip'
mkdirSync(join(root, 'release'), { recursive: true })
execSync(`rm -f release/${zipName} && cd dist && zip -r ../release/${zipName} .`, {
  cwd: root,
  stdio: 'inherit',
})

if (profile) {
  const names = BASES.map((base) => `${base}_${profile}`).join('、')
  console.log(`已生成 release/${zipName}，该包只读写：${names}`)
} else {
  console.log(`已生成 release/${zipName}，上传解压到网站根目录即可`)
}
