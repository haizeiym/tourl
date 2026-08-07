import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { JumpConfigFile, JumpItem } from '../types/jump'
import {
  buildJumpUrl,
  createEmptyConfig,
  createJumpItem,
  createJumpItemFromUrl,
  downloadJson,
  isHttpUrl,
  parseJumpConfig,
} from '../utils/jump'

export function useJumpStore() {
  const config = ref<JumpConfigFile>(createEmptyConfig())
  const selectedId = ref<string | null>(null)
  const dirty = ref(false)
  const iframeSrc = ref<string | null>(null)
  const focusNameToken = ref(0)

  const selectedItem = computed(() => {
    if (!selectedId.value) return null
    return config.value.items.find((i) => i.id === selectedId.value) ?? null
  })

  const isIframePreview = computed(() => iframeSrc.value !== null)

  function markDirty() {
    dirty.value = true
  }

  function selectItem(id: string) {
    selectedId.value = id
  }

  function clearSelection() {
    selectedId.value = null
  }

  async function confirmDiscardIfNeeded(): Promise<boolean> {
    if (config.value.items.length === 0 && !dirty.value) return true
    try {
      await ElMessageBox.confirm('丢弃当前配置？未导出的修改将丢失。', '提示', {
        type: 'warning',
        confirmButtonText: '丢弃',
        cancelButtonText: '取消',
      })
      return true
    } catch {
      return false
    }
  }

  async function newConfig() {
    const ok = await confirmDiscardIfNeeded()
    if (!ok) return
    config.value = createEmptyConfig()
    selectedId.value = null
    dirty.value = false
    closeIframe()
    ElMessage.success('已新建空配置')
  }

  function addJump() {
    const item = createJumpItem()
    config.value.items.push(item)
    selectedId.value = item.id
    markDirty()
    focusNameToken.value += 1
  }

  async function addJumpFromUrl() {
    let input: string
    try {
      const result = await ElMessageBox.prompt('粘贴完整 URL，将自动拆分地址与参数', '根据 URL 添加跳转', {
        confirmButtonText: '添加',
        cancelButtonText: '取消',
        inputPlaceholder: 'https://example.com/path?key=value',
        inputPattern: /^https?:\/\/.+/i,
        inputErrorMessage: '请填写有效的 http(s) 地址',
      })
      input = result.value
    } catch {
      return
    }

    try {
      const item = createJumpItemFromUrl(input)
      config.value.items.push(item)
      selectedId.value = item.id
      markDirty()
      focusNameToken.value += 1
      ElMessage.success('已根据 URL 添加跳转')
    } catch (err) {
      console.error('[addJumpFromUrl]', err)
      const msg = err instanceof Error ? err.message : 'URL 解析失败'
      ElMessage.error(msg)
    }
  }

  async function importConfig(file: File) {
    try {
      const text = await file.text()
      const raw: unknown = JSON.parse(text)
      const parsed = parseJumpConfig(raw)
      config.value = parsed
      selectedId.value = null
      dirty.value = false
      closeIframe()
      ElMessage.success(`导入成功，共 ${parsed.items.length} 项`)
    } catch (err) {
      console.error('[importConfig]', err)
      const msg = err instanceof Error ? err.message : '文件格式无效'
      ElMessage.error(`导入失败：${msg}`)
    }
  }

  function exportConfig() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    downloadJson(`jump-config-${stamp}.json`, config.value)
    dirty.value = false
    ElMessage.success('已导出配置')
  }

  function updateSelected(patch: Partial<JumpItem>) {
    const item = selectedItem.value
    if (!item) return
    Object.assign(item, patch)
    markDirty()
  }

  function setArgs(args: Record<string, string>) {
    const item = selectedItem.value
    if (!item) return
    item.args = args
    markDirty()
  }

  async function deleteSelected() {
    const item = selectedItem.value
    if (!item) return
    try {
      await ElMessageBox.confirm(`确定删除「${item.name}」？`, '删除确认', {
        type: 'warning',
        confirmButtonText: '删除',
        cancelButtonText: '取消',
      })
    } catch {
      return
    }
    const id = item.id
    config.value.items = config.value.items.filter((i) => i.id !== id)
    if (selectedId.value === id) selectedId.value = null
    markDirty()
    ElMessage.success('已删除')
  }

  function closeIframe() {
    iframeSrc.value = null
  }

  function jumpSelected() {
    const item = selectedItem.value
    if (!item) return
    if (!isHttpUrl(item.url)) {
      ElMessage.error('请填写有效的 http(s) 地址')
      return
    }

    let finalUrl: string
    try {
      finalUrl = buildJumpUrl(item)
    } catch (err) {
      console.error('[jumpSelected] buildJumpUrl', err)
      ElMessage.error('请填写有效的 http(s) 地址')
      return
    }

    if (item.openMode === 'iframe') {
      iframeSrc.value = finalUrl
      return
    }

    const win = window.open(finalUrl, '_blank', 'noopener,noreferrer')
    if (!win) {
      ElMessage.warning('弹窗被拦截，请允许本站打开新标签页')
    }
  }

  return {
    config,
    selectedId,
    selectedItem,
    dirty,
    iframeSrc,
    isIframePreview,
    focusNameToken,
    selectItem,
    clearSelection,
    newConfig,
    addJump,
    addJumpFromUrl,
    importConfig,
    exportConfig,
    updateSelected,
    setArgs,
    deleteSelected,
    jumpSelected,
    closeIframe,
  }
}

export type JumpStore = ReturnType<typeof useJumpStore>
