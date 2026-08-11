# 角色与目标

你是一个资深的前端与游戏/UI 编辑器开发专家。请**从零实现**一个轻量级 URL 跳转配置工具，使最终产品与本规格**功能等价**（交互、数据流、持久化语义一致；UI 像素级外观不要求一致）。

实现时：**按本文件自包含规格落地**，不要依赖外部仓库源码。若某处未写死实现细节，选最简方案，但不得违反「硬性行为」。

## 使用场景

- 本地调试页：快速打开带固定参数的游戏/活动/后台页面
- 轻量配置面板：非开发人员也能增删改跳转项；部署到纯静态站点后多人共享同一份全局配置

## 成功标准（MVP / 功能等价）

- 可新建 / 导入 / 导出一份完整配置
- **全局可写、全员一致且必须持久化**：同一稳定存储（可依赖 Cloudflare 等稳定第三方）；禁止 jsonblob 等会过期方案；发版不得更换存储地址
- 中间 Grid 展示全部跳转入口，右侧可编辑选中项
- 支持「新标签页」与「当前页(iframe)」两种打开方式，默认新标签页
- 跳转 URL 按约定拼接参数与防缓存时间戳
- 可部署到**仅静态文件**的 nginx（无需服务器 PHP / Node）
- HTTP 非安全上下文下新建跳转仍可用（ID 生成需兜底）
- TypeScript 类型完整，核心交互无阻塞错误
- 移动端适配（<768 列表/属性切换）
- `npm run dev` / `npm run build` 可按本文约定工作

## 非目标（本期不做）

- 用户系统 / 登录鉴权 / 细粒度权限
- 实时 OT/CRDT 协同光标（采用「拉取 + 保存 + 乐观锁」即可）
- 图标文件上传到服务器（仅支持 URL 字符串）
- 复杂权限、路由嵌套、多项目管理
- 依赖线上主机执行 PHP / 在服务器上运行 `npm start`（生产以静态 + 共享云端为准）
- 像素级还原某套视觉稿（布局结构与交互必须对齐即可）

---

# 一、技术栈（定稿）

| 层级 | 选型 | 说明 |
|------|------|------|
| 框架 | Vue 3 + Composition API + `<script setup>` | 必须 |
| 构建 | Vite + `@vitejs/plugin-vue` | 必须 |
| 语言 | TypeScript（strict） | 必须，导出完整接口 |
| UI 库 | Element Plus | 定稿；中文 locale |
| 样式 | Tailwind CSS（可用 v4 + `@tailwindcss/vite`） | 布局与间距 |
| 状态 | 轻量 composable / `ref`+`reactive` | 不强制 Pinia |
| 开发持久化 | 本地 Node：`server/config-server.mjs` + `data/jump-config.json` | 仅 `npm run dev` |
| 生产持久化 | Cloudflare Worker + KV（`config-api/`）+ 静态 `data/cloud-url.txt` | 禁止用 localStorage 作为全员配置源 |
| 构建门禁 | `scripts/ensure-cloud-url.mjs` | 校验并同步固定云端地址；**不创建**新库 |

### 必需 npm scripts（名称与语义必须一致）

```json
{
  "dev": "concurrently -k -n server,web -c blue,green \"npm run server\" \"vite\"",
  "server": "node server/config-server.mjs",
  "build": "node scripts/ensure-cloud-url.mjs && vue-tsc -b && vite build",
  "deploy:config-api": "cd config-api && npx wrangler deploy"
}
```

- `dev`：同时起本地配置 API（默认端口 **8787**）与 Vite
- Vite `server.proxy`：把 `/api` 代理到 `http://127.0.0.1:8787`
- 本地调试可跳过云端门禁：`SKIP_CLOUD=1 npm run build`（**不可用于生产发版**）

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
   * 每次成功写入云端/本地 API 时由服务端更新；客户端保存时带回，用于乐观锁。
   */
  updatedAt: number
  /** 跳转项列表（有序；Grid 按数组顺序渲染） */
  items: JumpItem[]
}
```

> 说明：统一为 `args`（不是 `agrs`）。定稿为 `items` 数组，`id` 放在对象内部。

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

## 2.2.1 全局可写多人协作（生产：必须持久化）

### 硬性要求

1. **无论如何必须数据持久化**：生产环境「保存到全局」的数据不得因发版、刷新、换机器、第三方临时库过期而丢失
2. **可以依赖稳定的第三方**（本规格默认 Cloudflare Workers + KV；也可自建**语义等价** API），须同时满足：
   - 有持久存储（KV / DB / 对象存储等），**无“短期过期自动删除”**
   - 提供**长期稳定**的 HTTPS 读写地址（发版不更换）
   - 支持本文「§2.2.2 配置 API 契约」的 GET/PUT/乐观锁/CORS
3. **禁止不稳定方案**（实现与构建须拦截）：
   - jsonblob、类似“临时 pastebin / 会过期的 JSON 托管”
   - 仅靠浏览器 localStorage / 仅靠静态 `jump-config.json` 充当多人可写源
   - 每次构建自动创建新存储地址（导致旧数据失联）

### 本仓库默认实现（稳定第三方）

| 位置 | 作用 |
|------|------|
| Cloudflare Worker + KV（`config-api/`） | **真正的全局配置存储**（持久、可写、乐观锁） |
| `data/cloud-url.txt` | 指向该 API 的**固定**地址（一行 `https://.../config`；一旦写好发版**禁止更换**） |
| `public/data/cloud-url.txt` | 构建/开发时由脚本从 `data/cloud-url.txt` 同步，供站点以 `/data/cloud-url.txt` 提供 |
| `data/jump-config.json` | 仅本地种子；云端不可用时的**只读兜底**（不可作为生产唯一写入源） |

### 客户端读写行为（功能必须一致）

| 场景 | 行为 |
|------|------|
| 开发 `import.meta.env.DEV` | 读/写一律走同源 `/api/config`（Vite 代理到本地 Node），**不依赖** `cloud-url.txt` |
| 生产读取 | 先读站点 `/data/cloud-url.txt`（一行 https，忽略 `#` 注释行）→ GET 该 URL（加 `?_t=` 防缓存）→ 失败则只读回退 `/data/jump-config.json`（或 `/jump-config.json`） |
| 生产写入 | 必须已有有效 cloud URL；PUT 该 URL；无地址时**明确报错**，不得静默写临时库 |
| 不稳定地址 | 若 cloud URL 命中 `jsonblob.com` / `jsonbin.io` / `pastebin.com` 等，视为无效并忽略 |
| localStorage | 可缓存 cloud URL / Inspector 宽度等；**不得**作为全员配置权威源；站点 `cloud-url.txt` 优先于缓存 |
| 冲突 | 客户端 `updatedAt` 与服务端不一致 → 409 或等价冲突；UI 提示「刷新」或「强制覆盖」；强制覆盖带 `?force=1` |
| 前端发版 | 只更新 `index.html` + `assets/`；**永不更换** `cloud-url.txt` |
| 构建 | `ensure-cloud-url.mjs`：有有效 https 则同步到 `public/data/`；指向不稳定域名/占位符/空 → **构建失败**（`SKIP_CLOUD=1` 可跳过） |
| 备份 | 支持导出 JSON；迁移存储前必须先导出 |

### 上线一次性步骤（写入 README，agent 须实现可部署的 `config-api/`）

```bash
npx wrangler login
cd config-api
npx wrangler kv namespace create JUMP_CONFIG
# 把输出的 id 填进 wrangler.toml 的 [[kv_namespaces]].id
cd ..
npm run deploy:config-api
# 将 https://<worker-name>.<account>.workers.dev/config 写入 data/cloud-url.txt（仅一行）
```

## 2.2.2 配置 API 契约（开发本地 API 与生产 Worker 语义一致）

两端都必须实现下列语义（路径可不同，但字段与状态码一致）：

| 项 | 约定 |
|------|------|
| 生产路径 | `GET/PUT https://.../config`（也允许 `/` 指向同一逻辑） |
| 开发路径 | `GET/PUT /api/config`（Node 监听 `PORT` 默认 **8787**） |
| CORS（生产） | `Access-Control-Allow-Origin: *`；Methods: `GET, PUT, OPTIONS`；Headers: `Content-Type`；OPTIONS → 204 |
| Cache | 响应带 `Cache-Control: no-store`（或客户端一律 `cache: 'no-store'` + `?_t=`） |
| GET | 返回完整 `JumpConfigFile` JSON；无数据时 `{ "updatedAt": 0, "items": [] }` |
| PUT body | JSON 对象，必须含 `items` 数组；缺省/非法 → **400** |
| 乐观锁 | 比较客户端带来的 `updatedAt` 与当前存储值；不等且非 force → **409** |
| force | 查询参数 `force=1` 时跳过乐观锁，直接覆盖 |
| PUT 成功 | 服务端设置 `updatedAt = Date.now()`，持久化后返回最新 `JumpConfigFile` |
| 409 body | `{ "error": string, "serverConfig": JumpConfigFile }` |

Worker（生产）额外约定：

- Wrangler Worker 名建议 `jumpl-config`
- KV binding 名必须为 **`JUMP_CONFIG`**
- KV 内存储 key 建议固定为 `jump-config`（字符串 JSON）
- `config-api/wrangler.toml` 需含 `main`、`compatibility_date`、`[[kv_namespaces]]`（binding + id）
- `config-api/worker.js`（或等价）实现上述 GET/PUT/OPTIONS

本地 Node（开发）额外约定：

- 读写文件：`data/jump-config.json`
- 同样支持 `?force=1` 与 409
- 可选：`SERVE_STATIC=1` 时兼作静态预览（非必须功能）

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

## 2.5 必备工具函数（语义必须实现）

| 函数 | 行为 |
|------|------|
| `createId()` | 优先 `crypto.randomUUID()`；否则 `getRandomValues` 拼 UUID；再否则时间戳+随机串 |
| `createJumpItem()` | 返回 §2.4 默认项 |
| `createJumpItemFromUrl(raw)` | 校验 http(s)；`url`=origin+pathname+hash（去掉 search）；query→`args`（忽略空 key 与 `_t`）；`name`=路径末段或 hostname（≤64）；`openMode=tab` |
| `buildJumpUrl(item)` | 见 §三 |
| `parseJumpConfig(raw)` | 校验并规范化为 `JumpConfigFile`；失败抛错 |
| `isHttpUrl(value)` | 仅接受 http/https 绝对地址 |

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
| 保存到全局 | 写入全员共用存储（开发写本地 API，生产写 cloud URL）；冲突时提示刷新或强制覆盖；生产未配置有效地址时明确报错 |
| 刷新全局 | 防缓存重新拉取；若有未保存变更先确认 |
| 新建配置 | 有未保存变更先确认；内存清空 `items`（`updatedAt` 可保留或置 0，但下一次保存须走服务端新戳）；需再保存才同步 |
| 导入配置 | 选 `.json` → 校验 → 替换内存；不自动写全局；标记未保存 |
| 导出配置 | 下载当前配置为本地 JSON 备份 |
| 新建跳转 | 追加默认项并选中；ID 用 `createId()` |
| 根据URL添加跳转 | 弹窗粘贴完整 URL → `createJumpItemFromUrl` → 追加并选中 |

未保存变更时 Top Bar 显示「未保存」提示。

## 4.2 中间 Grid 列表

- CSS Grid，`auto-fill`，单卡最小约 120px（移动端约 96px）
- **名称完整显示**：不使用单行截断（`truncate`）；允许换行（`break-words`），卡片高度随名称自适应
- 上图标下名称；无/失败 `iconUrl` 用名称首字（空名为 `?`）
- 单击选中，高亮；空列表提示新建
- 顺序同 `items`；不做拖拽排序
- 右侧属性面板宽度变化时，Grid 区域随 flex 自动重排列数

## 4.3 右侧属性面板（Inspector）

未选中：「选择一个跳转进行编辑」。

| 控件 | 绑定字段 |
|------|----------|
| 名称 | `name` |
| 打开方式 | `openMode`：单选 **新标签页** / **当前页**（值仍为 `tab` / `iframe`） |
| 图标 URL | `iconUrl` |
| 跳转地址 | `url` |
| 参数列表 | `args`：键/值行，可增删 |
| 复制当前配置 | 位于**参数列表正下方**（随参数行数增减上下浮动，不固定在面板底栏）；点击复制当前选中项（新 `id`，其余字段深拷贝，`name` 追加「 副本」并截断至 64）；插入到原项后方并**自动选中**新项；未选中时提示 |

操作按钮组（均在参数列表下方、随参数行数浮动，自上而下）：

1. **复制当前配置**
2. **跳转**（按该条 `openMode`）与 **删除**（确认框）同一行、紧挨「复制当前配置」下方

不再使用面板底部固定底栏。

属性即时写回内存；持久化依赖「保存到全局」或「导出」。

### 桌面端宽度拖拽

- 属性面板与中间 Grid 之间提供可拖拽分隔条（左右拉动）
- 默认宽度约 320px；最小约 280px；最大不超过视口约 70%
- 拖拽时属性面板变宽/变窄，中间 Grid 自动占满剩余空间并重排
- 宽度可写入 `localStorage` 以便下次打开保持

## 4.4 跳转打开方式

### 新标签页（`tab`，默认）

`window.open(finalUrl, '_blank', 'noopener,noreferrer')`；被拦截则 Toast。

### 当前页（`iframe`）

1. 中间全宽 `<iframe :src="finalUrl">`
2. 「关闭 / 返回列表」销毁 iframe
3. 不做跨域内容通信

## 4.5 移动端适配（< 768px）

- **布局**：不并排三栏；默认全宽 Grid 列表；点击卡片进入全宽属性页；属性页顶部「返回」回到列表
- **顶栏**：保留「保存 / 刷新 / 新建」主操作；其余收入「更多」下拉（根据 URL 添加、新建配置、导入、导出）
- **Grid**：卡片更紧凑（约 96px 起）
- **iframe 预览**：全宽；返回按钮文案缩短为「返回」
- **桌面（≥ 768px）**：保持原三栏布局不变
- 使用 `h-dvh` / 安全区，避免移动浏览器地址栏导致高度裁切

---

# 五、工程与实现要求

## 5.1 建议目录（名称可微调，职责必须覆盖）

```
src/
  types/jump.ts
  utils/jump.ts          # createId / buildJumpUrl / parseJumpConfig / fromUrl …
  utils/api.ts           # resolveCloudUrl / fetchGlobalConfig / saveGlobalConfig / ConfigConflictError
  composables/useJumpStore.ts
  composables/useIsMobile.ts
  components/TopBar.vue
  components/JumpGrid.vue
  components/JumpCard.vue
  components/InspectorPanel.vue
  components/IframePreview.vue
  App.vue
  main.ts
server/config-server.mjs
scripts/ensure-cloud-url.mjs
config-api/worker.js
config-api/wrangler.toml
data/cloud-url.txt
data/jump-config.json
public/data/cloud-url.txt
public/data/jump-config.json
```

## 5.2 硬性实现约束

1. 严格类型，避免 `any`
2. Element Plus 中文 locale；关键交互 Toast / 确认框
3. 生产构建：`node scripts/ensure-cloud-url.mjs && vue-tsc -b && vite build`
4. 生产全局配置使用 Cloudflare Worker + KV（`config-api/`）；`cloud-url.txt` 指向该固定地址
5. 发版只覆盖 `index.html` + `assets/`；**禁止更换** `cloud-url.txt`（更换等于换库）
6. 构建不创建临时云端、不用种子覆盖线上数据
7. Vite 开发代理 `/api` → `127.0.0.1:8787`
8. `ensure-cloud-url.mjs` 必须拦截至少：`jsonblob.com`、空地址、占位符（如含「你的账号」、`example.com`、`localhost`）

## 5.3 README 必须说明

- 一次性部署 Worker + 写入 `cloud-url.txt`
- 前端发版只更新 `index.html` + `assets/`
- `npm run dev` / `npm run build` / `SKIP_CLOUD=1`
- 禁止 jsonblob 等不稳定方案

---

# 六、验收清单（功能等价判定）

全部通过即视为与本规格**功能相同**：

### 基础 UI / 编辑

- [ ] 启动可见 Top Bar + Grid + Inspector
- [ ] 新建跳转在 **HTTP** 站点可用，Grid 出现卡片，右侧可编辑
- [ ] 无/无效 iconUrl 回退首字
- [ ] 导出/导入符合 `JumpConfigFile`；非法导入不覆盖
- [ ] 新建配置有二次确认；未保存时刷新/新建有确认
- [ ] 复制当前配置：新 id、名称带「 副本」、插入原项后并选中
- [ ] 删除有确认，选中态正确
- [ ] 桌面 Inspector 可拖拽改宽并记忆
- [ ] 移动端（宽 < 768）可在列表与属性页间切换；顶栏主操作可用；更多菜单含导入导出
- [ ] 桌面端仍为 Grid + Inspector 并排

### 跳转

- [ ] 跳转 tab：新标签，URL 含业务参数与 `_t`
- [ ] 跳转「当前页」：iframe 可关闭返回
- [ ] `url` 非法不可跳转并提示
- [ ] 「根据 URL 添加」正确拆分 base / args，并忽略 `_t`

### 持久化 / 协作

- [ ] 开发：`npm run dev` 下保存/刷新走本地 `/api/config` 且重启后数据仍在 `data/jump-config.json`
- [ ] 生产：`dist/data/cloud-url.txt` 为一行稳定 https 地址
- [ ] 两人打开同一部署站点，初始读到**同一**全局配置
- [ ] A 保存到全局后，B 刷新全局可见最新
- [ ] 基于过期 `updatedAt` 保存时有冲突提示，可强制覆盖（`force=1`）
- [ ] 无有效 `cloud-url.txt` 时生产保存明确失败；构建默认失败（除非 `SKIP_CLOUD=1`）
- [ ] 指向 jsonblob 等不稳定地址时构建失败或运行时拒绝作为写入源
- [ ] 控制台不因缺失 `cloud-url.txt` 反复 404（构建产物中应带该文件）

### API

- [ ] Worker：OPTIONS/GET/PUT `/config` 行为符合 §2.2.2
- [ ] 本地 Node：`/api/config` 行为符合 §2.2.2

---

# 七、交付物

1. 可运行工程：`npm install && npm run dev`（本地 API）
2. 可部署的 `config-api/`（Worker + wrangler）与说明
3. 生产构建：`npm run build`（已配置有效 `cloud-url.txt` 时），上传完整 `dist/`
4. 类型与核心组件；样例 `data/jump-config.json` / `public/data/jump-config.json`
5. `README.md` 说明一步静态部署与全员共用配置约定

---

# 八、给实现 agent 的执行顺序（建议）

1. 初始化 Vue3 + Vite + TS + Element Plus + Tailwind
2. 落地类型、`jump.ts` 工具、`useJumpStore`、三栏 UI
3. 实现 `server/config-server.mjs` + Vite proxy，打通开发读写与乐观锁
4. 实现 `config-api` Worker（§2.2.2）与 `ensure-cloud-url.mjs`
5. 实现生产 `api.ts`（resolveCloudUrl / 冲突 / 强制覆盖 / 不稳定地址拦截）
6. 补移动端适配与 README
7. 对照 §六验收清单逐项自测；全部勾选后再交付
