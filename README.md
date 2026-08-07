# URL 跳转工具

## 一步部署（全员同一份配置）

```bash
npm install
npm run build
```

上传 **整个 `dist/`**（必须包含 `data/cloud-url.txt`，且里面是一行 `https://...`）。

- `npm run build` 会生成/复用**全员共用**的云端配置地址，写入 `dist/data/cloud-url.txt`
- 所有人打开站点都读这个地址 → 配置一致
- 服务器不需要 PHP / Node

若有人以前点过保存，浏览器可能缓存了旧的个人地址：让其硬刷新，或以站点上的 `cloud-url.txt` 为准（代码已改为站点文件优先）。

## 本地开发

```bash
npm run dev
```
