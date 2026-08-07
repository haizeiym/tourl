# 角色与目标

你是一个资深的前端与游戏/UI 编辑器开发专家。请实现一个**轻量级 URL 跳转配置工具**：用可视化方式管理一组跳转入口（名称、图标、URL、参数），支持导入/导出配置，并能以新标签页或 iframe 方式打开目标地址。

## 使用场景

- 本地调试页：快速打开带固定参数的游戏/活动/后台页面
- 轻量配置面板：非开发人员也能增删改跳转项并分享 JSON 配置

## 成功标准（MVP）

- 可新建 / 导入 / 导出一份完整配置
- 中间 Grid 展示全部跳转入口，右侧可编辑选中项
- 支持「新标签页」与「iframe」两种打开方式，默认新标签页
- 跳转 URL 按约定拼接参数与防缓存时间戳
- TypeScript 类型完整，核心交互无阻塞错误

## 非目标（本期不做）

- 用户系统、云端同步、多人协作
- 图标文件上传到服务器（仅支持 URL 字符串）
- 复杂权限、路由嵌套、多项目管理
- 移动端优先适配（桌面可用即可）

---

# 一、技术栈（定稿）

| 层级 | 选型 | 说明 |
|------|------|------|
| 框架 | Vue 3 + Composition API + `<script setup>` | 必须 |
| 构建 | Vite | 必须 |
| 语言 | TypeScript（strict） | 必须，导出完整接口 |
| UI 库 | Element Plus | 定稿（不再二选一） |
| 样式 | Tailwind CSS | 布局与间距；组件外观以 Element Plus 为主 |
| 状态 | 轻量 composable / `ref`+`reactive` 即可 | 不强制 Pinia |
| 持久化 | 内存 + 显式导入/导出 JSON 文件 | 不做自动 localStorage（可后续扩展） |

---

# 二、数据模型

## 2.1 TypeScript 接口

运行时数据与配置文件使用同一套结构（**不是**带 `type`/`default` 的 schema 描述）：

```ts
/** 单条跳转配置 */
export interface JumpItem {
  /** 唯一 ID，字符串；新建时用 crypto.randomUUID() 或递增数字字符串 */
  id: string
  /** 打开方式；默认 tab（新标签页） */
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
  /** 跳转项列表（有序；Grid 按数组顺序渲染） */
  items: JumpItem[]
}
```

> 说明：原稿中的 `agrs` 视为笔误，统一为 `args`。原稿用 `"1": { ... }` 的 map 结构；为便于排序与导出，**定稿为 `items` 数组**，`id` 放在对象内部。

## 2.2 配置文件示例

```json
{
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
- 导入时校验：`items` 为数组，每项含 `id/openMode/name/url/args`，`openMode` 为 `'tab' | 'iframe'`，且 `args` 为对象（`Record<string, string>`）；失败则 Toast 提示并不覆盖当前数据

## 2.3 字段校验规则

| 字段 | 规则 |
|------|------|
| `openMode` | 必填；仅允许 `'tab'` 或 `'iframe'`；缺省按 `'tab'` |
| `name` | 必填，trim 后长度 1–64 |
| `iconUrl` | 可选；非空时须为合法 URL，加载失败时回退为首字占位 |
| `url` | 必填；`http:` 或 `https:` 绝对地址 |
| `args` | `Record<string, string>`；UI 按「键 / 值」行编辑，可增删行；key 建议非空且不重复；value 长度建议 ≤ 512 |
| `id` | 创建后不可在 UI 中编辑；删除后不复用该 id |

## 2.4 默认新建项

```ts
{
  id: /* 新生成 */,
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
2. 遍历 `Object.entries(item.args)`，将每个 `key=value` 写入 query（编码由 `URLSearchParams` 处理）；跳过空 key
3. 追加防缓存参数：`_t=<Date.now()>`（毫秒时间戳）
4. 若原 URL 已有 query，则在其后追加，不清除已有参数；若已有同名 key / `_t`，以本次写入覆盖

示例：

- `url` = `https://example.com/game`
- `args` = `{ "key1": "value", "key2": "value" }`
- 结果：`https://example.com/game?key1=value&key2=value&_t=1730000000000`

打开前若 `url` 非法，拦截跳转并提示「请填写有效的 http(s) 地址」。

---

# 四、界面布局与交互

整体为三栏桌面布局：

```
┌─────────────────────────────────────────────────────────┐
│ Top Bar：新建配置 | 导入 | 导出 | 新建跳转                │
├──────────────────────────────┬──────────────────────────┤
│                              │                          │
│  中间 Grid 列表               │  右侧 Inspector           │
│                              │                          │
└──────────────────────────────┴──────────────────────────┘
```

某项 `openMode` 为 iframe 并执行跳转时，中间区域切换为全宽 iframe 视图（实现时优先：**中间替换为 iframe，顶部增加「关闭预览」**）。

## 4.1 顶部导航栏

| 操作 | 行为 |
|------|------|
| 新建配置 | 若当前有未导出变更，先确认「丢弃当前配置？」；确认后重置为 `{ items:[] }`，清空选中 |
| 导入配置 | 选择 `.json` 文件 → 校验 → 成功则替换当前配置并清空选中；失败不改动 |
| 导出配置 | 将当前 `JumpConfigFile` 下载为 `jump-config.json`（或带时间戳文件名） |
| 新建跳转 | 追加默认项到 `items` 末尾并选中 |
| 根据URL添加跳转 | 弹出输入框粘贴完整 URL → 解析为跳转项并追加到 `items` 末尾并选中：`url` = origin+pathname（保留 hash，去掉 search）；query 写入 `args`（忽略 `_t`）；`name` 取路径末段或 hostname；`openMode` 默认 `tab` |

## 4.2 中间 Grid 列表

- CSS Grid 展示，自适应列数（建议 `auto-fill`，单卡最小约 120px）
- 卡片结构：上方图标区，下方名称
  - 有 `iconUrl`：显示 `<img>`，`onerror` 回退为首字
  - 无 `iconUrl` 或加载失败：圆形/方块占位，居中显示 `name` 的第一个可见字符（`name` 为空时显示 `?`）
- 单击卡片：设为当前选中，右侧展示其属性；选中态有高亮边框
- 空列表：居中提示「暂无跳转，点击「新建跳转」开始」
- 顺序：与 `items` 数组一致；本期不做拖拽排序

## 4.3 右侧属性面板（Inspector）

未选中时：显示占位文案「选择一个跳转进行编辑」。

选中时展示并可编辑：

| 控件 | 绑定字段 |
|------|----------|
| 名称 | `name` |
| 打开方式 | `openMode`：单选 `新标签页(tab)` / `iframe`；默认 `tab` |
| 图标 URL | `iconUrl` |
| 跳转地址 | `url` |
| 参数列表 | `args`：可「添加参数」「删除单行」；每行两个输入框（key / value），写回 `Record<string, string>` |

底部操作：

| 按钮 | 行为 |
|------|------|
| 跳转 | 按**该条目**的 `openMode` 打开拼接后的 URL |
| 删除 | `ElMessageBox.confirm` 确认后从 `items` 移除；若删的是当前选中则清空选中 |

属性修改即时写回内存中的 `items`（无需单独「保存」按钮；持久化依赖「导出」）。

## 4.4 跳转打开方式

### 新标签页（默认）

`window.open(finalUrl, '_blank', 'noopener,noreferrer')`  
若被浏览器拦截，Toast 提示用户允许弹窗。

### iframe

1. 进入 iframe 预览态，用 `<iframe :src="finalUrl">` 加载
2. 顶部或 iframe 浮层提供「关闭 / 返回列表」按钮，销毁 iframe（清空 `src` 并切回 Grid）
3. 注意：跨域页面无法读取 iframe 内部状态，只负责加载与销毁，不做内容通信

---

# 五、工程与实现要求

1. 使用 Vite 创建 Vue 3 + TS 项目，目录清晰：`types/`、`composables/`、`components/` 等
2. 提供严格类型，避免 `any`
3. Element Plus 按需或全量引入均可，保证中文 locale
4. 关键交互完整：确认框、成功/失败 Toast、表单基础校验
5. 代码可读、命名与本文件术语一致（`JumpItem`、`openMode`、`args` 等）

---

# 六、验收清单

- [ ] 启动后可见 Top Bar + 空 Grid + Inspector 占位
- [ ] 新建跳转后 Grid 出现卡片，右侧可改 name / openMode / iconUrl / url / args
- [ ] 无 iconUrl 时显示名称首字；有无效 iconUrl 时回退首字
- [ ] 导出 JSON 符合 `JumpConfigFile`（`openMode` 在 item 内）；再导入可完整还原
- [ ] 导入非法文件时提示错误且不覆盖现有数据
- [ ] 新建配置在有数据时会二次确认
- [ ] 跳转（item.openMode=tab）：新标签打开，URL 含 `key1=value&key2=value` 形式参数与 `_t`
- [ ] 跳转（item.openMode=iframe）：页面内打开，可关闭返回列表
- [ ] 删除有确认框，确认后列表与选中态正确更新
- [ ] `url` 非法时不能跳转并有提示

---

# 七、交付物

1. 可运行的前端工程（`npm install && npm run dev`）
2. 本需求中的类型定义与核心组件实现
3. 一份符合示例结构的样例 `jump-config.json`（可选，便于演示导入）
