/**
 * 构建前校验全员共用「持久化」配置地址。
 * - 禁止 jsonblob 等不稳定临时库
 * - 未配置有效地址时默认构建失败（SKIP_CLOUD=1 可跳过，仅本地调试）
 * - 只同步 data/cloud-url.txt → public/data/，绝不创建新库、绝不覆盖远端数据
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const STATE = path.join(ROOT, 'data', 'cloud-url.txt')
const OUT = path.join(ROOT, 'public', 'data', 'cloud-url.txt')

/** 已知会过期/不稳定的托管（禁止用于生产持久化） */
const UNSTABLE_HOST_RE =
  /jsonblob\.com|jsonbin\.io|httpbin\.org|pastebin\.com|gist\.githubusercontent\.com/i

function readUrl(file) {
  if (!fs.existsSync(file)) return ''
  const line = fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('#') && /^https?:\/\//i.test(l))
  return line || ''
}

function fail(msg) {
  console.error(`[ensure-cloud-url] ${msg}`)
  console.error(
    '[ensure-cloud-url] 生产必须使用稳定持久化 API（推荐 Cloudflare Worker，见 README）。本地调试可设 SKIP_CLOUD=1',
  )
  process.exit(1)
}

function main() {
  if (process.env.SKIP_CLOUD === '1') {
    console.warn('[ensure-cloud-url] SKIP_CLOUD=1：跳过持久化校验（不可用于生产发版）')
    return
  }

  const url = readUrl(STATE) || readUrl(OUT)
  fs.mkdirSync(path.dirname(OUT), { recursive: true })
  fs.mkdirSync(path.dirname(STATE), { recursive: true })

  if (!url) {
    const hint = `# 必须填写「稳定持久化」配置 API 地址（一行 https，不要用 jsonblob）
# 推荐：Cloudflare Worker + KV（本仓库 config-api/）
# 示例：https://jumpl-config.<你的账号>.workers.dev/config
#
# 部署步骤见 README
`
    if (!fs.existsSync(STATE) || !readUrl(STATE)) {
      fs.writeFileSync(STATE, hint, 'utf8')
    }
    fs.writeFileSync(OUT, hint, 'utf8')
    fail('未配置 data/cloud-url.txt。全局数据无法持久化，拒绝构建。')
  }

  if (UNSTABLE_HOST_RE.test(url)) {
    fail(`禁止使用不稳定存储：${url}`)
  }

  if (/[<>]|你的账号|example\.com|localhost|127\.0\.0\.1/i.test(url)) {
    fail(`cloud-url.txt 仍是占位/本地地址，请填入已部署的持久化 API：${url}`)
  }

  fs.writeFileSync(STATE, `${url}\n`, 'utf8')
  fs.writeFileSync(OUT, `${url}\n`, 'utf8')
  console.log(`[ensure-cloud-url] 持久化地址已同步\n  ${url}`)
}

main()
