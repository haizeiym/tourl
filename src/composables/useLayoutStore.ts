import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import type { JumpItem } from '../types/jump'
import {
  DEFAULT_INSPECTOR_FIELDS,
  DEFAULT_TOOLBAR_ORDER,
  kindLabel,
  mergeOrder,
  moveId,
  type InspectorFieldId,
  type ToolbarId,
} from '../types/layout'
import { fetchFieldLayout, fetchItemLayout, saveFieldLayout, saveItemLayout } from '../utils/api'

export function useLayoutStore() {
  const itemOrder = ref<string[]>([])
  const toolbarOrder = ref<string[]>([...DEFAULT_TOOLBAR_ORDER])
  const inspectorOrder = ref<string[]>([...DEFAULT_INSPECTOR_FIELDS])
  const kindFilter = ref<string>('all')
  const layoutDirty = ref(false)
  const loadingLayout = ref(false)
  const savingLayout = ref(false)

  const toolbarIds = computed(() =>
    mergeOrder(toolbarOrder.value, DEFAULT_TOOLBAR_ORDER) as ToolbarId[],
  )

  const inspectorIds = computed(() =>
    mergeOrder(inspectorOrder.value, DEFAULT_INSPECTOR_FIELDS) as InspectorFieldId[],
  )

  function markLayoutDirty() {
    layoutDirty.value = true
  }

  function kindsFromItems(items: JumpItem[]): string[] {
    const set = new Set<string>()
    for (const item of items) {
      set.add(item.kind || 'normal')
    }
    return [...set]
  }

  function kindOptions(items: JumpItem[]): Array<{ value: string; label: string }> {
    return [
      { value: 'all', label: '全部' },
      ...kindsFromItems(items).map((kind) => ({
        value: kind,
        label: kindLabel(kind),
      })),
    ]
  }

  function visibleItems(items: JumpItem[]): JumpItem[] {
    const map = new Map(items.map((i) => [i.id, i]))
    const ordered: JumpItem[] = []
    const used = new Set<string>()
    for (const id of itemOrder.value) {
      const it = map.get(id)
      if (!it || used.has(id)) continue
      ordered.push(it)
      used.add(id)
    }
    for (const it of items) {
      if (used.has(it.id)) continue
      ordered.push(it)
    }
    if (kindFilter.value === 'all') return ordered
    return ordered.filter((i) => (i.kind || 'normal') === kindFilter.value)
  }

  function syncItemOrder(items: JumpItem[]) {
    const ids = items.map((i) => i.id)
    const merged = [
      ...itemOrder.value.filter((id) => ids.includes(id)),
      ...ids.filter((id) => !itemOrder.value.includes(id)),
    ]
    if (merged.join() !== itemOrder.value.join()) {
      itemOrder.value = merged
    }
  }

  function reorderItems(fromId: string, toId: string) {
    itemOrder.value = moveId(itemOrder.value, fromId, toId)
    markLayoutDirty()
  }

  function reorderToolbar(fromId: string, toId: string) {
    toolbarOrder.value = moveId(toolbarOrder.value, fromId, toId)
    markLayoutDirty()
  }

  function reorderInspector(fromId: string, toId: string) {
    inspectorOrder.value = moveId(inspectorOrder.value, fromId, toId)
    markLayoutDirty()
  }

  async function loadLayout(opts?: { silent?: boolean }) {
    loadingLayout.value = true
    try {
      const [items, fields] = await Promise.all([
        fetchItemLayout(),
        fetchFieldLayout(),
      ])
      itemOrder.value = items.itemOrder
      toolbarOrder.value = items.toolbarOrder
      inspectorOrder.value = fields.inspectorOrder
      layoutDirty.value = false
      if (!opts?.silent) ElMessage.success('已读取位置信息')
    } catch (err) {
      console.error('[loadLayout]', err)
      ElMessage.error(err instanceof Error ? err.message : '读取位置失败')
    } finally {
      loadingLayout.value = false
    }
  }

  async function saveLayout() {
    savingLayout.value = true
    try {
      await Promise.all([
        saveItemLayout({
          itemOrder: itemOrder.value,
          toolbarOrder: toolbarOrder.value,
        }),
        saveFieldLayout({
          inspectorOrder: inspectorOrder.value,
        }),
      ])
      layoutDirty.value = false
      ElMessage.success('已保存位置信息到独立 KV')
    } catch (err) {
      console.error('[saveLayout]', err)
      ElMessage.error(err instanceof Error ? err.message : '保存位置失败')
    } finally {
      savingLayout.value = false
    }
  }

  return {
    itemOrder,
    toolbarOrder,
    inspectorOrder,
    kindFilter,
    layoutDirty,
    loadingLayout,
    savingLayout,
    toolbarIds,
    inspectorIds,
    kindOptions,
    visibleItems,
    syncItemOrder,
    reorderItems,
    reorderToolbar,
    reorderInspector,
    loadLayout,
    saveLayout,
  }
}

export type LayoutStore = ReturnType<typeof useLayoutStore>
