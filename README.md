# URL 跳转工具

## 一步部署（全员同一份配置）

```bash
npm install
npm run build
```

上传 **`dist/`** 到网站根目录。全局可写配置存在 **云端**（由 `data/cloud-url.txt` 指向），不在服务器磁盘上的业务 JSON 里。

## 发版时不要冲掉全局配置

### 全局配置在哪？

| 位置 | 作用 |
|------|------|
| `data/cloud-url.txt` | 全员共用的云端地址（**务必保持同一行 URL**） |
| 云端 JSON（jsonblob） | 真正的全局配置内容（保存到全局写这里） |
| `data/jump-config.json` | 仅兜底/种子，有云端时**不会**作为主数据源 |

### 建议只覆盖这些（前端更新）

- `index.html`
- `assets/`（整目录替换即可）
- `favicon.svg` / `icons.svg`（可选）

### 不要随便覆盖 / 改掉

- **`data/cloud-url.txt`**：换成别的地址 = 连到另一份空/旧配置，看起来像「全局被覆盖」
- 若整包上传 `dist/`：可以覆盖 `cloud-url.txt`，但内容必须仍是**原来那一行**（本地 `data/cloud-url.txt` / `public/data/cloud-url.txt` 不要删、不要重新生成新 blob）

### 构建注意

- 默认 `npm run build` **不会**再用本地种子去 PUT 覆盖云端
- 只有明确要重置云端时才用：`SYNC_CLOUD_SEED=1 npm run build`

## 本地开发

```bash
npm run dev
```
