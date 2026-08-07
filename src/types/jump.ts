/** 打开方式 */
export type OpenMode = 'tab' | 'iframe'

/** 单条跳转配置 */
export interface JumpItem {
  /** 唯一 ID */
  id: string
  /** 打开方式；默认 tab */
  openMode: OpenMode
  /** 显示名称 */
  name: string
  /** 图标 URL；空字符串表示无图标 */
  iconUrl: string
  /** 跳转基础地址 */
  url: string
  /** 查询参数键值对 */
  args: Record<string, string>
}

/** 整个配置文件 */
export interface JumpConfigFile {
  items: JumpItem[]
}

/** Inspector 中编辑用的参数行 */
export interface ArgRow {
  key: string
  value: string
}
