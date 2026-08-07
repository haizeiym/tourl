import { computed, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { JumpConfigFile, JumpItem } from '../types/jump'
import {
  ConfigConflictError,
  fetchGlobalConfig,
  saveGlobalConfig,
} from '../utils/api'
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
  const loading = ref(false)
  const saving = ref(false)

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
    if (!dirty.value) return true
    try {
      await ElMessageBox.confirm('丢弃当前未保存的修改？', '提示', {
        type: 'warning',
        confirmButtonText: '丢弃',
        cancelButtonText: '取消',
      })
      return true
    } catch {
      return false
    }
  }

  function applyConfig(next: JumpConfigFile, clearDirty = true) {
    config.value = next
    selectedId.value = null
    if (clearDirty) dirty.value = false
    closeIframe()
  }

  async function loadGlobalConfig(opts?: { confirmDirty?: boolean }) {
    if (opts?.confirmDirty !== false) {
      const ok = await confirmDiscardIfNeeded()
      if (!ok) return
    }
    loading.value = true
    try {
      const remote = await fetchGlobalConfig()
      applyConfig(remote)
      ElMessage.success(`已加载全局配置（${remote.items.length} 项）`)
    } catch (err) {
      console.error('[loadGlobalConfig]', err)
      const msg = err instanceof Error ? err.message : '加载失败'
      ElMessage.error(`加载全局配置失败：${msg}`)
    } finally {
      loading.value = false
    }
  }

  async function refreshGlobal() {
    await loadGlobalConfig({ confirmDirty: true })
  }

  async function saveToGlobal(force = false) {
    saving.value = true
    try {
      const result = await saveGlobalConfig(config.value, force)
      config.value = result.config
      dirty.value = false
      if (result.needUploadCloudUrl) {
        await ElMessageBox.alert(
          '已创建云端配置并下载 cloud-url.txt。\n请把该文件上传到网站的 data/cloud-url.txt（仅需一次），之后所有人打开页面即可多人同步。\n本机已可立即使用。',
          '首次启用云端协作',
          { confirmButtonText: '知道了', type: 'success' },
        )
      } else {
        ElMessage.success('已保存到全局配置')
      }
    } catch (err) {
      console.error('[saveToGlobal]', err)
      if (err instanceof ConfigConflictError) {
        try {
          await ElMessageBox.confirm(
            `${err.message}\n\n选择「强制覆盖」将用你的版本覆盖他人修改；或取消后点「刷新全局」。`,
            '保存冲突',
            {
              type: 'warning',
              distinguishCancelAndClose: true,
              confirmButtonText: '强制覆盖',
              cancelButtonText: '取消',
            },
          )
          await saveToGlobal(true)
        } catch {
          /* cancelled */
        }
        return
      }
      const msg = err instanceof Error ? err.message : '保存失败'
      ElMessage.error(`保存失败：${msg}`)
    } finally {
      saving.value = false
    }
  }

  async function newConfig() {
    const ok = await confirmDiscardIfNeeded()
    if (!ok) return
    // 保留已知 updatedAt，便于之后保存时走冲突检测
    config.value = {
      updatedAt: config.value.updatedAt,
      items: [],
    }
    selectedId.value = null
    dirty.value = true
    closeIframe()
    ElMessage.success('已清空本地配置（保存到全局后生效）')
  }

  function addJump() {
    try {
      const item = createJumpItem()
      config.value.items.push(item)
      selectedId.value = item.id
      markDirty()
      focusNameToken.value += 1
    } catch (err) {
      console.error('[addJump]', err)
      ElMessage.error(err instanceof Error ? err.message : '新建跳转失败')
    }
  }

  async function addJumpFromUrl() {
    let input: string
    try {
      const result = await ElMessageBox.prompt(
        '粘贴完整 URL，将自动拆分地址与参数',
        '根据 URL 添加跳转',
        {
          confirmButtonText: '添加',
          cancelButtonText: '取消',
          inputPlaceholder: 'https://example.com/path?key=value',
          inputPattern: /^https?:\/\/.+/i,
          inputErrorMessage: '请填写有效的 http(s) 地址',
        },
      )
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
      // 导入只改内存；保留当前服务端版本戳，避免误覆盖时跳过冲突检测
      applyConfig(
        { updatedAt: config.value.updatedAt, items: parsed.items },
        false,
      )
      dirty.value = true
      ElMessage.success(`导入成功，共 ${parsed.items.length} 项（需保存到全局才同步）`)
    } catch (err) {
      console.error('[importConfig]', err)
      const msg = err instanceof Error ? err.message : '文件格式无效'
      ElMessage.error(`导入失败：${msg}`)
    }
  }

  function exportConfig() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    downloadJson(`jump-config-${stamp}.json`, config.value)
    ElMessage.success('已导出本地备份')
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
    loading,
    saving,
    selectItem,
    clearSelection,
    loadGlobalConfig,
    refreshGlobal,
    saveToGlobal,
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
