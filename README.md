# URL 跳转工具

## 数据持久化（硬性）

生产环境全局配置**必须**落在稳定持久化存储上：

- ✅ 推荐：Cloudflare Workers + KV（本仓库 `config-api/`，免费、地址固定、数据不因发版丢失）
- ✅ 可替换：任意自建/稳定第三方 HTTP API（长期保存、固定 URL、支持 GET/PUT）
- ❌ 禁止：jsonblob、临时 paste 类、仅 localStorage、每次构建换新地址

---

## 一次性：部署持久化 API（Cloudflare）

```bash
npx wrangler login

cd config-api
npx wrangler kv namespace create JUMP_CONFIG
npx wrangler kv namespace create JUMP_LOBBY
npx wrangler kv namespace create JUMP_CONFIG_BACKUP
npx wrangler kv namespace create JUMP_LOBBY_BACKUP
# 把四个输出的 id 分别填进 wrangler.toml：
#   JUMP_CONFIG         → 跳转列表
#   JUMP_LOBBY          → 大厅参数
#   JUMP_CONFIG_BACKUP  → 列表备份
#   JUMP_LOBBY_BACKUP   → 大厅备份

cd ..
npm run deploy:config-api
```

将部署得到的地址写入 **`data/cloud-url.txt`**（仅一行）：

```text
https://jumpl-config.<你的账号>.workers.dev/config
```

上传该文件到站点 `data/cloud-url.txt`。此后**永远不要换这个地址**。

未配置有效地址时，`npm run build` 会失败（本地调试可 `SKIP_CLOUD=1 npm run build`）。

---

## 前端发版（不丢数据）

```bash
npm run build
```

只更新：`index.html`、`assets/`  
保留：`data/cloud-url.txt`（固定 Worker 地址）

数据在 Cloudflare KV，与静态站点发版无关。

### 打包

```bash
npm run pack
npm run pack -- beta
```

- 不带参数：`release/jumpl-dist.zip`，读写现有 `JUMP_CONFIG`、`JUMP_LOBBY`、`JUMP_CONFIG_BACKUP`、`JUMP_LOBBY_BACKUP`、`JUMP_ITEM_LAYOUT`、`JUMP_FIELD_LAYOUT`。
- 带参数（字母开头，仅字母数字下划线）：为该名称创建上述 6 个 KV 的独立副本（已存在则复用，不覆盖数据），写入 `wrangler.toml` 并部署 Worker，打出 `release/jumpl-dist-<名称>.zip`。该包请求带 `kv=<名称>`，只读写 `JUMP_CONFIG_<名称>` 等对应库。`cloud-url.txt` 仍指向同一个 Worker。

---

## 本地开发

```bash
npm run dev
```

使用本机 Node API（`data/jump-config.json`）。
