# URL 跳转工具

Vue 3 + Vite + Element Plus。

## 一步部署（纯静态 nginx，无需 PHP / Node）

```bash
npm install
npm run build
```

上传 **整个 `dist/`** 到网站根目录。

### 为什么以前会 404？

你的主机是 **nginx 静态站**，不会执行 PHP（`config.php` 被当成文件下载），也没有 Node。  
因此 `/api/config`、`config.php` 都不能用。

### 现在怎么多人读写？

1. 打开页面：自动读 `/data/jump-config.json`（静态文件，已可用）
2. 第一次点「保存到全局」：浏览器会创建云端配置，并下载 `cloud-url.txt`
3. 把 `cloud-url.txt` **上传到** 网站 `data/cloud-url.txt`（只做一次）
4. 之后所有人打开站点即可共同读写同一份配置

## 本地开发

```bash
npm run dev
```

需求见 `prompt.md`。
