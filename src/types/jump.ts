/** 打开方式 */
export type OpenMode = 'tab' | 'iframe'

/** 跳转项类型：normal=普通 URL；lobby=大厅登录跳转（参数存独立 KV） */
export type JumpKind = 'normal' | 'lobby'

/** 大厅特殊项参数（对齐 deploy_lobby 配置面板） */
export interface LobbyConfig {
  api_protocol: 'http' | 'https'
  redirect_protocol: 'http' | 'https'
  server: string
  appKey: string
  path: string
  uuid: string
  nickname: string
  session: string
  channel_id: number
  merchant_id: number
  game_id: number
  game_redirect: string
}

/** 单条跳转配置 */
export interface JumpItem {
  /** 唯一 ID */
  id: string
  /** 项类型；缺省按 normal */
  kind: JumpKind
  /** 打开方式；默认 tab */
  openMode: OpenMode
  /** 显示名称 */
  name: string
  /** 图标 URL；空字符串表示无图标 */
  iconUrl: string
  /**
   * 跳转基础地址。
   * lobby 项可为空字符串（跳转走登录 API，不使用本字段拼接）。
   */
  url: string
  /** 查询参数键值对（lobby 项通常为空） */
  args: Record<string, string>
}

/** 整个配置文件 */
export interface JumpConfigFile {
  /**
   * 服务端版本戳（毫秒）。
   * 保存时带回；服务端写入成功后更新。
   */
  updatedAt: number
  /** 跳转项列表（有序；Grid 按数组顺序渲染） */
  items: JumpItem[]
}

/** Inspector 中编辑用的参数行 */
export interface ArgRow {
  key: string
  value: string
}
