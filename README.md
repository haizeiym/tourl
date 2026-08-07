# URL 跳转工具

基于 Vue 3 + Vite + TypeScript + Element Plus + Tailwind CSS。  
支持**全局可写配置**（多人读写同一份 JSON，乐观锁冲突检测）。

## 开发

```bash
npm install
npm run dev
```

会同时启动：

- 配置 API：`http://127.0.0.1:8787`（数据文件 `data/jump-config.json`）
- 前端：Vite（`/api` 代理到上述服务）

## 生产

```bash
npm run build
npm start
```

同一端口提供静态页面 + `/api/config`。

## 协作说明

| 操作 | 说明 |
|------|------|
| 启动 / 刷新全局 | `GET /api/config`（`no-store`），拿到最新配置 |
| 保存到全局 | `PUT /api/config`；`updatedAt` 不一致返回 409，可强制覆盖 |
| 导入 / 导出 | 仅本地备份；导入后需再点「保存到全局」才同步给他人 |

需求说明见 `prompt.md`。
