export const DEFAULT_TOOLBAR_ORDER = [
  'saveGlobal',
  'saveLobby',
  'refresh',
  'backup',
  'addJump',
  'addLobby',
  'fromUrl',
  'newConfig',
  'import',
  'export',
  'loadLayout',
  'saveLayout',
] as const

export type ToolbarId = (typeof DEFAULT_TOOLBAR_ORDER)[number]

export const DEFAULT_INSPECTOR_FIELDS = [
  'name',
  'openMode',
  'iconUrl',
  'url',
  'args',
  'lobbyServer',
  'lobbyUser',
  'lobbyBiz',
  'lobbyReset',
  'duplicate',
  'jump',
  'delete',
] as const

export type InspectorFieldId = (typeof DEFAULT_INSPECTOR_FIELDS)[number]

export interface ItemLayoutFile {
  itemOrder: string[]
  toolbarOrder: string[]
}

export interface FieldLayoutFile {
  inspectorOrder: string[]
}

export const KIND_LABELS: Record<string, string> = {
  normal: '普通',
  lobby: '大厅',
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind
}

export function mergeOrder(saved: string[], defaults: readonly string[]): string[] {
  const allow = new Set(defaults)
  const out: string[] = []
  const seen = new Set<string>()
  for (const id of saved) {
    if (!allow.has(id) || seen.has(id)) continue
    out.push(id)
    seen.add(id)
  }
  for (const id of defaults) {
    if (seen.has(id)) continue
    out.push(id)
    seen.add(id)
  }
  return out
}

export function parseItemLayout(raw: unknown): ItemLayoutFile {
  const obj =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const itemOrder = Array.isArray(obj.itemOrder)
    ? obj.itemOrder.filter((x): x is string => typeof x === 'string' && Boolean(x))
    : []
  const toolbarOrder = Array.isArray(obj.toolbarOrder)
    ? obj.toolbarOrder.filter((x): x is string => typeof x === 'string' && Boolean(x))
    : []
  return {
    itemOrder,
    toolbarOrder: mergeOrder(toolbarOrder, DEFAULT_TOOLBAR_ORDER),
  }
}

function expandLegacyInspectorIds(ids: string[]): string[] {
  const out: string[] = []
  for (const id of ids) {
    if (id === 'actions') {
      out.push('duplicate', 'jump', 'delete')
      continue
    }
    out.push(id)
  }
  return out
}

export function parseFieldLayout(raw: unknown): FieldLayoutFile {
  const obj =
    typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const inspectorOrder = Array.isArray(obj.inspectorOrder)
    ? expandLegacyInspectorIds(
        obj.inspectorOrder.filter((x): x is string => typeof x === 'string' && Boolean(x)),
      )
    : []
  return {
    inspectorOrder: mergeOrder(inspectorOrder, DEFAULT_INSPECTOR_FIELDS),
  }
}

export function moveId(order: string[], fromId: string, toId: string): string[] {
  if (fromId === toId) return order
  const next = order.filter((id) => id !== fromId)
  const toIndex = next.indexOf(toId)
  if (toIndex < 0) return [...next, fromId]
  next.splice(toIndex, 0, fromId)
  return next
}
