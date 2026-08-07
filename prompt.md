# 角色与目标

你是一个资深的前端与游戏/UI 编辑器开发专家。请实现一个**轻量级 URL 跳转配置工具**：用可视化方式管理一组跳转入口（名称、图标、URL、参数），支持导入/导出配置，并能以新标签页或当前页（iframe）方式打开目标地址。

## 使用场景

- 本地调试页：快速打开带固定参数的游戏/活动/后台页面
- 轻量配置面板：非开发人员也能增删改跳转项；部署到纯静态站点后多人共享同一份全局配置

## 成功标准（MVP）

- 可新建 / 导入 / 导出一份完整配置
- **全局可写且全员一致**：所有人读写**同一**云端配置；读取带防缓存参数；禁止每人各自一份云端地址
- 中间 Grid 展示全部跳转入口，右侧可编辑选中项
- 支持「新标签页」与「当前页(iframe)」两种打开方式，默认新标签页
- 跳转 URL 按约定拼接参数与防缓存时间戳
- 可部署到**仅静态文件**的 nginx（无需服务器 PHP / Node）
- HTTP 非安全上下文下新建跳转仍可用（ID 生成需兜底）
- TypeScript 类型完整，核心交互无阻塞错误

## 非目标（本期不做）

- 用户系统 / 登录鉴权 / 细粒度权限
- 实时 OT/CRDT 协同光标（采用「拉取 + 保存 + 乐观锁」即可）
- 图标文件上传到服务器（仅支持 URL 字符串）
- 复杂权限、路由嵌套、多项目管理
- 移动端优先适配（桌面可用即可）
- 依赖线上主机执行 PHP / 在服务器上运行 `npm start`（生产以静态 + 共享云端为准）

---

# 一、技术栈（定稿）

| 层级 | 选型 | 说明 |
|------|------|------|
| 框架 | Vue 3 + Composition API + `<script setup>` | 必须 |
| 构建 | Vite | 必须；`npm run build` 前生成全员共用云端地址 |
| 语言 | TypeScript（strict） | 必须，导出完整接口 |
| UI 库 | Element Plus | 定稿；中文 locale |
| 样式 | Tailwind CSS | 布局与间距 |
| 状态 | 轻量 composable / `ref`+`reactive` | 不强制 Pinia |
| 开发持久化 | 本地 Node：`server/config-server.mjs` + `data/jump-config.json` | 仅 `npm run dev` |
| 生产持久化 | **共享云端 JSON**（构建写入 `dist/data/cloud-url.txt`）+ 静态资源 | 禁止用 localStorage 作为全员配置源 |

---

# 二、数据模型

## 2.1 TypeScript 接口

运行时数据与配置文件使用同一套结构（**不是**带 `type`/`default` 的 schema 描述）：

```ts
/** 单条跳转配置 */
export interface JumpItem {
  /**
   * 唯一 ID。
   * 使用 createId()：优先 crypto.randomUUID()；
   * HTTP 非安全上下文无 randomUUID 时用 getRandomValues / 时间戳兜底。
   */
  id: string
  /** 打开方式；默认 tab（新标签页）；iframe 在 UI 文案为「当前页」 */
  openMode: 'tab' | 'iframe'
  /** 显示名称，必填，trim 后非空 */
  name: string
  /** 图标 URL；空字符串表示无图标，UI 用 name 首字作为占位 */
  iconUrl: string
  /** 跳转基础地址，必填；须为合法绝对 URL（http/https） */
  url: string
  /**
   * 查询参数（键值对）。
   * 跳转时拼接为 key1=value&key2=value（见「URL 拼接规范」）。
   * key 为空的条目不参与拼接；value 允许空字符串。
   */
  args: Record<string, string>
}

/** 整个配置文件 */
export interface JumpConfigFile {
  /**
   * 版本戳（毫秒时间戳）。
   * 每次成功写入云端/本地 API 时更新；客户端保存时带回，用于乐观锁。
   */
  updatedAt: number
  /** 跳转项列表（有序；Grid 按数组顺序渲染） */
  items: JumpItem[]
}
```

> 说明：原稿中的 `agrs` 视为笔误，统一为 `args`。定稿为 `items` 数组，`id` 放在对象内部。

## 2.2 配置文件示例

```json
{
  "updatedAt": 0,
  "items": [
    {
      "id": "1",
      "openMode": "tab",
      "name": "测试跳转1",
      "iconUrl": "",
      "url": "https://example.com/path",
      "args": {
        "key1": "value",
        "key2": "value"
      }
    }
  ]
}
```

- 文件扩展名：`.json`
- 导入时校验：`items` 为数组，每项含 `id/openMode/name/url/args`，`openMode` 为 `'tab' | 'iframe'`，且 `args` 为对象；`updatedAt` 缺省按 `0`；失败则 Toast 且不覆盖当前数据

## 2.2.1 全局可写多人协作（生产：静态站）

适用于像 `bot.ht666.xyz` 这类**仅 nginx 静态托管、不执行 PHP、不跑 Node** 的环境。

### 共享约定

| 文件 | 作用 |
|------|------|
| `dist/data/cloud-url.txt` | **全员共用**云端配置地址，一行 `https://...`（由 `npm run build` 生成/复用） |
| `dist/data/jump-config.json` | 种子/兜底静态配置；有云端地址时**以云端为准** |

### 行为

- **构建**：`scripts/prepare-shared-cloud.mjs` 创建或复用云端库，同步种子数据，写入 `public/data/cloud-url.txt`（进入 `dist`）
- **读取**：启动 /「刷新全局」→ 读站点 `data/cloud-url.txt`（`?_t=` 防缓存）→ 再 GET 该云端 URL（防缓存）；**站点文件优先于 localStorage**，读到后写回 localStorage，避免每人地址不一致
- **写入**：「保存到全局」→ PUT 到上述**同一**云端 URL；更新 `updatedAt`；**禁止**在浏览器里再创建个人云端库
- **冲突（乐观锁）**：保存前比对云端 `updatedAt`；不一致则提示刷新或强制覆盖
- **本地导入/导出**：备份/迁移；导入只改内存，需再点「保存到全局」才同步他人
- **不做**：WebSocket 推送、按字段合并、用户鉴权

### 开发环境

- `npm run dev`：Vite 代理 `/api` → 本地 `server/config-server.mjs`，读写 `data/jump-config.json`
- 生产逻辑不依赖 `/api/config` 或 `config.php`

## 2.3 字段校验规则

| 字段 | 规则 |
|------|------|
| `openMode` | 必填；仅允许 `'tab'` 或 `'iframe'`；缺省按 `'tab'` |
| `name` | 必填，trim 后长度 1–64 |
| `iconUrl` | 可选；非空时须为合法 URL，加载失败时回退为首字占位 |
| `url` | 必填；`http:` 或 `https:` 绝对地址 |
| `args` | `Record<string, string>`；UI 按「键 / 值」行编辑，可增删行；key 建议非空且不重复；value 长度建议 ≤ 512 |
| `id` | 创建后不可在 UI 中编辑；删除后不复用该 id；生成须兼容 HTTP 页面 |

## 2.4 默认新建项

```ts
{
  id: /* createId() */,
  openMode: "tab",
  name: "未命名跳转",
  iconUrl: "",
  url: "https://",
  args: {}
}
```

新建后自动选中并聚焦右侧「名称」输入框。

---

# 三、URL 拼接规范

给定 `item.url` 与 `item.args`，最终打开地址计算如下：

1. 以 `item.url` 为基准解析为 `URL` 对象
2. 遍历 `Object.entries(item.args)`，将每个 `key=value` 写入 query（由 `URLSearchParams` 编码）；跳过空 key
3. 追加防缓存参数：`_t=<Date.now()>`
4. 若原 URL 已有 query，则追加/覆盖同名 key，不整体清除

示例：

- `url` = `https://example.com/game`
- `args` = `{ "key1": "value", "key2": "value" }`
- 结果：`https://example.com/game?key1=value&key2=value&_t=1730000000000`

打开前若 `url` 非法，拦截并提示「请填写有效的 http(s) 地址」。

---

# 四、界面布局与交互

整体为三栏桌面布局：

```
┌──────────────────────────────────────────────────────────────────┐
│ Top Bar：保存到全局 | 刷新全局 | 新建配置 | 导入 | 导出 | 新建跳转 | 根据URL添加 │
├────────────────────────────────────┬─────────────────────────────┤
│  中间 Grid 列表                     │  右侧 Inspector              │
└────────────────────────────────────┴─────────────────────────────┘
```

某项 `openMode === 'iframe'` 并跳转时：中间替换为 iframe，顶部提供「关闭预览 / 返回列表」。

## 4.1 顶部导航栏

| 操作 | 行为 |
|------|------|
| 保存到全局 | 写入全员共用云端（开发环境写本地 API）；冲突时提示刷新或强制覆盖；未部署 `cloud-url.txt` 有效地址时明确报错 |
| 刷新全局 | 防缓存重新拉取；若有未保存变更先确认 |
| 新建配置 | 有未保存变更先确认；内存清空 `items`；需再保存才同步 |
| 导入配置 | 选 `.json` → 校验 → 替换内存；不自动写全局 |
| 导出配置 | 下载当前配置为本地 JSON 备份 |
| 新建跳转 | 追加默认项并选中；ID 用 `createId()`（兼容 HTTP） |
| 根据URL添加跳转 | 弹窗粘贴完整 URL → 解析：`url`=origin+pathname（保留 hash，去掉 search）；query→`args`（忽略 `_t`）；`name`=路径末段或 hostname；`openMode`=`tab`；追加并选中 |

未保存变更时 Top Bar 显示「未保存」提示。

## 4.2 中间 Grid 列表

- CSS Grid，`auto-fill`，单卡最小约 120px
- 上图标下名称；无/失败 `iconUrl` 用名称首字（空名为 `?`）
- 单击选中，高亮；空列表提示新建
- 顺序同 `items`；不做拖拽排序

## 4.3 右侧属性面板（Inspector）

未选中：「选择一个跳转进行编辑」。

| 控件 | 绑定字段 |
|------|----------|
| 名称 | `name` |
| 打开方式 | `openMode`：单选 **新标签页** / **当前页**（值仍为 `tab` / `iframe`） |
| 图标 URL | `iconUrl` |
| 跳转地址 | `url` |
| 参数列表 | `args`：键/值行，可增删 |

底部：跳转（按该条 `openMode`）；删除（确认框）。

属性即时写回内存；持久化依赖「保存到全局」或「导出」。

## 4.4 跳转打开方式

### 新标签页（`tab`，默认）

`window.open(finalUrl, '_blank', 'noopener,noreferrer')`；被拦截则 Toast。

### 当前页（`iframe`）

1. 中间全宽 `<iframe :src="finalUrl">`
2. 「关闭 / 返回列表」销毁 iframe
3. 不做跨域内容通信

---

# 五、工程与实现要求

1. 目录：`types/`、`composables/`、`components/`、`utils/`、`server/`（仅开发）、`scripts/prepare-shared-cloud.mjs`
2. 严格类型，避免 `any`
3. Element Plus 中文 locale；关键交互 Toast / 确认框
4. 生产构建：`node scripts/prepare-shared-cloud.mjs && vue-tsc -b && vite build`
5. 部署：上传**整个** `dist/`（含 `data/cloud-url.txt` 与 `data/jump-config.json`）；服务器无需 Node/PHP
6. 他人若曾保存过个人云端：硬刷新后以站点 `cloud-url.txt` 为准对齐

---

# 六、验收清单

- [ ] 启动可见 Top Bar + Grid + Inspector
- [ ] 新建跳转在 **HTTP** 站点可用，Grid 出现卡片，右侧可编辑
- [ ] 无/无效 iconUrl 回退首字
- [ ] 导出/导入符合 `JumpConfigFile`；非法导入不覆盖
- [ ] 新建配置有二次确认
- [ ] 跳转 tab：新标签，URL 含业务参数与 `_t`
- [ ] 跳转「当前页」：iframe 可关闭返回
- [ ] 删除有确认，选中态正确
- [ ] `url` 非法不可跳转并提示
- [ ] 生产：`dist/data/cloud-url.txt` 为一行 https 地址
- [ ] 两人打开同一部署站点，初始读到**同一**全局配置
- [ ] A 保存到全局后，B 刷新全局可见最新
- [ ] 基于同一 `updatedAt` 冲突保存时有提示，可强制覆盖
- [ ] 控制台不因缺失 `cloud-url.txt` 反复 404（构建产物中应带该文件）

---

# 七、交付物

1. 可运行工程：`npm install && npm run dev`（本地 API）
2. 生产构建：`npm run build`，上传完整 `dist/`
3. 类型与核心组件；样例 `data/jump-config.json` / `public/data/jump-config.json`
4. `README.md` 说明一步静态部署与全员共用配置约定
