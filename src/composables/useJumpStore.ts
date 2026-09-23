import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { JumpConfigFile, JumpItem, LobbyConfig } from '../types/jump'
import {
  ConfigConflictError,
  backupGlobalStores,
  deleteLobbyConfig,
  fetchAllLobbyConfigs,
  fetchGlobalConfig,
  fetchLobbyConfig,
  saveGlobalConfig,
  saveLobbyConfig,
} from '../utils/api'
import {
  buildJumpUrl,
  createEmptyConfig,
  createId,
  createJumpItem,
  createJumpItemFromUrl,
  downloadJson,
  isHttpUrl,
  parseJumpConfig,
} from '../utils/jump'
import {
  createDefaultLobbyConfig,
  createLobbyJumpItem,
  executeLobbyJump,
  ensureLocalLobbyUser,
  lobbyForSharedStore,
  parseLobbyConfig,
  writeLocalLobbyUser,
} from '../utils/lobby'

export function useJumpStore() {
  const config = ref<JumpConfigFile>(createEmptyConfig())
  const selectedId = ref<string | null>(null)
  const dirty = ref(false)
  const lobbyDirty = ref(false)
  const iframeSrc = ref<string | null>(null)
  const focusNameToken = ref(0)
  const loading = ref(false)
  const saving = ref(false)
  const savingLobby = ref(false)
  const backingUp = ref(false)
  const jumping = ref(false)
  /** 大厅参数内存缓存（权威持久化在独立 KV / 本地 lobby 文件） */
  const lobbyById = reactive<Record<string, LobbyConfig>>({})

  const selectedItem = computed(() => {
    if (!selectedId.value) return null
    return config.value.items.find((i) => i.id === selectedId.value) ?? null
  })

  const selectedLobby = computed(() => {
    const item = selectedItem.value
    if (!item || item.kind !== 'lobby') return null
    return lobbyById[item.id] ?? null
  })

  const isIframePreview = computed(() => iframeSrc.value !== null)

  function markDirty() {
    dirty.value = true
  }

  function markLobbyDirty() {
    lobbyDirty.value = true
  }

  function applyLocalUserToAllLobbies() {
    const user = ensureLocalLobbyUser()
    for (const id of Object.keys(lobbyById)) {
      lobbyById[id] = { ...lobbyById[id]!, ...user }
    }
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

  function clearLobbyCache() {
    for (const key of Object.keys(lobbyById)) {
      delete lobbyById[key]
    }
  }

  async function hydrateLobbies(items: JumpItem[]) {
    clearLobbyCache()
    const fromKv = await fetchAllLobbyConfigs()
    for (const [id, lobby] of Object.entries(fromKv)) {
      lobbyById[id] = lobby
    }

    const lobbyItems = items.filter((i) => i.kind === 'lobby')
    const missing: string[] = []
    await Promise.all(
      lobbyItems.map(async (item) => {
        if (lobbyById[item.id]) return
        try {
          const remote = await fetchLobbyConfig(item.id)
          if (remote) {
            lobbyById[item.id] = remote
            return
          }
        } catch (err) {
          console.warn('[hydrateLobbies]', item.id, err)
        }
        missing.push(item.name || item.id)
        lobbyById[item.id] = createDefaultLobbyConfig()
      }),
    )
    applyLocalUserToAllLobbies()

    if (lobbyItems.length === 0 && Object.keys(fromKv).length > 0) {
      console.warn(
        '[hydrateLobbies] JUMP_LOBBY 有数据，但全局列表没有 kind=lobby 的项；请先「保存到全局」',
        Object.keys(fromKv),
      )
    }
    if (missing.length > 0) {
      ElMessage.warning(
        `大厅 KV 中没有这些项的参数，已用默认值：${missing.join('、')}。请点「保存大厅全局」`,
      )
    }
  }

  async function persistLobbies(items: JumpItem[]) {
    const lobbyItems = items.filter((i) => i.kind === 'lobby')
    await Promise.all(
      lobbyItems.map(async (item) => {
        const lobby = lobbyById[item.id] ?? createDefaultLobbyConfig()
        lobbyById[item.id] = lobby
        await saveLobbyConfig(item.id, lobbyForSharedStore(lobby))
      }),
    )
  }

  function mergeLobbyCardsFromKv() {
    const known = new Set(config.value.items.map((i) => i.id))
    for (const [id, lobby] of Object.entries(lobbyById)) {
      const existing = config.value.items.find((i) => i.id === id)
      if (existing) {
        existing.kind = 'lobby'
        continue
      }
      if (known.has(id)) continue
      config.value.items.push({
        id,
        kind: 'lobby',
        openMode: 'tab',
        name: `大厅 ${lobby.game_id}`.slice(0, 64),
        iconUrl: '',
        url: '',
        args: {},
      })
      known.add(id)
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
      await hydrateLobbies(remote.items)
      mergeLobbyCardsFromKv()
      lobbyDirty.value = false
      const lobbyCount = config.value.items.filter((i) => i.kind === 'lobby').length
      ElMessage.success(
        `已加载全局配置（${config.value.items.length} 项，大厅 KV ${lobbyCount} 项）`,
      )
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
      ElMessage.success('已保存到全局配置（不含大厅参数）')
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

  async function saveLobbiesToGlobal() {
    const lobbyItems = config.value.items.filter((i) => i.kind === 'lobby')
    if (lobbyItems.length === 0) {
      ElMessage.warning('当前没有大厅项可保存')
      return
    }
    savingLobby.value = true
    try {
      await persistLobbies(lobbyItems)
      lobbyDirty.value = false
      ElMessage.success(`已保存 ${lobbyItems.length} 条大厅参数到独立 KV`)
    } catch (err) {
      console.error('[saveLobbiesToGlobal]', err)
      const msg = err instanceof Error ? err.message : '保存失败'
      ElMessage.error(`保存大厅失败：${msg}`)
    } finally {
      savingLobby.value = false
    }
  }

  async function backupToKv() {
    backingUp.value = true
    try {
      const result = await backupGlobalStores()
      ElMessage.success(
        `已备份到 Cloudflare KV（JUMP_CONFIG ${result.configKeys} 键 / JUMP_LOBBY ${result.lobbyKeys} 键）`,
      )
    } catch (err) {
      console.error('[backupToKv]', err)
      ElMessage.error(err instanceof Error ? err.message : '备份失败')
    } finally {
      backingUp.value = false
    }
  }

  async function newConfig() {
    const ok = await confirmDiscardIfNeeded()
    if (!ok) return
    config.value = {
      updatedAt: config.value.updatedAt,
      items: [],
    }
    clearLobbyCache()
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

  function addLobbyJump() {
    try {
      const { item, lobby } = createLobbyJumpItem()
      config.value.items.push(item)
      lobbyById[item.id] = lobby
      selectedId.value = item.id
      markDirty()
      markLobbyDirty()
      focusNameToken.value += 1
      ElMessage.success('已新建大厅（列表点「保存到全局」，参数点「保存大厅全局」）')
    } catch (err) {
      console.error('[addLobbyJump]', err)
      ElMessage.error(err instanceof Error ? err.message : '新建大厅跳转失败')
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
      // 导入可附带 lobbies 映射，或 item.lobby 兜底
      clearLobbyCache()
      if (typeof raw === 'object' && raw !== null && 'lobbies' in raw) {
        const map = (raw as { lobbies?: unknown }).lobbies
        if (map && typeof map === 'object') {
          for (const [id, value] of Object.entries(map as Record<string, unknown>)) {
            try {
              lobbyById[id] = parseLobbyConfig(value)
            } catch {
              /* skip */
            }
          }
        }
      }
      for (const item of parsed.items) {
        if (item.kind !== 'lobby') continue
        if (lobbyById[item.id]) continue
        const embedded =
          typeof raw === 'object' &&
          raw !== null &&
          Array.isArray((raw as { items?: unknown[] }).items)
            ? ((raw as { items: Array<Record<string, unknown>> }).items.find(
                (i) => i && i.id === item.id,
              ) as Record<string, unknown> | undefined)
            : undefined
        if (embedded && embedded.lobby) {
          try {
            lobbyById[item.id] = parseLobbyConfig(embedded.lobby)
            continue
          } catch {
            /* fallthrough */
          }
        }
        lobbyById[item.id] = createDefaultLobbyConfig()
      }

      applyConfig(
        { updatedAt: config.value.updatedAt, items: parsed.items },
        false,
      )
      dirty.value = true
      if (parsed.items.some((i) => i.kind === 'lobby')) lobbyDirty.value = true
      ElMessage.success(`导入成功，共 ${parsed.items.length} 项（列表/大厅需分别保存到全局）`)
    } catch (err) {
      console.error('[importConfig]', err)
      const msg = err instanceof Error ? err.message : '文件格式无效'
      ElMessage.error(`导入失败：${msg}`)
    }
  }

  function exportConfig() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const lobbies: Record<string, LobbyConfig> = {}
    for (const item of config.value.items) {
      if (item.kind === 'lobby' && lobbyById[item.id]) {
        lobbies[item.id] = lobbyForSharedStore(lobbyById[item.id]!)
      }
    }
    downloadJson(`jump-config-${stamp}.json`, {
      ...config.value,
      lobbies,
    })
    ElMessage.success('已导出本地备份（含大厅参数）')
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

  function updateSelectedLobby(patch: Partial<LobbyConfig>) {
    const item = selectedItem.value
    if (!item || item.kind !== 'lobby') return
    const { uuid, nickname, ...shared } = patch
    if (uuid !== undefined || nickname !== undefined) {
      writeLocalLobbyUser({ uuid, nickname })
      applyLocalUserToAllLobbies()
    }
    if (Object.keys(shared).length === 0) return
    const current = lobbyById[item.id] ?? createDefaultLobbyConfig()
    lobbyById[item.id] = { ...current, ...shared, ...ensureLocalLobbyUser() }
    markLobbyDirty()
  }

  function resetSelectedLobby() {
    const item = selectedItem.value
    if (!item || item.kind !== 'lobby') return
    lobbyById[item.id] = createDefaultLobbyConfig()
    markLobbyDirty()
    ElMessage.success('已重置大厅默认参数')
  }

  function duplicateSelected() {
    const source = selectedItem.value
    if (!source) {
      ElMessage.warning('请先选择一个跳转')
      return
    }
    try {
      const copy: JumpItem = {
        id: createId(),
        kind: source.kind ?? 'normal',
        openMode: source.openMode,
        name: `${source.name} 副本`.slice(0, 64),
        iconUrl: source.iconUrl,
        url: source.url,
        args: { ...source.args },
      }
      if (copy.kind === 'lobby') {
        const srcLobby = lobbyById[source.id] ?? createDefaultLobbyConfig()
        lobbyById[copy.id] = {
          ...srcLobby,
          uuid: srcLobby.uuid,
          nickname: srcLobby.nickname,
        }
      }
      const index = config.value.items.findIndex((i) => i.id === source.id)
      if (index >= 0) {
        config.value.items.splice(index + 1, 0, copy)
      } else {
        config.value.items.push(copy)
      }
      selectedId.value = copy.id
      markDirty()
      if (copy.kind === 'lobby') markLobbyDirty()
      focusNameToken.value += 1
      ElMessage.success('已复制当前配置')
    } catch (err) {
      console.error('[duplicateSelected]', err)
      ElMessage.error(err instanceof Error ? err.message : '复制失败')
    }
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
    const wasLobby = item.kind === 'lobby'
    config.value.items = config.value.items.filter((i) => i.id !== id)
    if (selectedId.value === id) selectedId.value = null
    if (wasLobby) {
      delete lobbyById[id]
      try {
        await deleteLobbyConfig(id)
      } catch (err) {
        console.warn('[deleteSelected] lobby kv', err)
      }
    }
    markDirty()
    ElMessage.success('已删除')
  }

  function closeIframe() {
    iframeSrc.value = null
  }

  async function jumpSelected() {
    const item = selectedItem.value
    if (!item) return

    if (item.kind === 'lobby') {
      const lobby = lobbyById[item.id] ?? createDefaultLobbyConfig()
      jumping.value = true
      try {
        const { finalUrl } = await executeLobbyJump(lobby)
        if (item.openMode === 'iframe') {
          iframeSrc.value = finalUrl
          return
        }
        const win = window.open(finalUrl, '_blank', 'noopener,noreferrer')
        if (!win) {
          ElMessage.warning('弹窗被拦截，请允许本站打开新标签页')
        }
      } catch (err) {
        console.error('[jumpSelected] lobby', err)
        ElMessage.error(err instanceof Error ? err.message : '大厅跳转失败')
      } finally {
        jumping.value = false
      }
      return
    }

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
    selectedLobby,
    dirty,
    lobbyDirty,
    iframeSrc,
    isIframePreview,
    focusNameToken,
    loading,
    saving,
    savingLobby,
    backingUp,
    jumping,
    lobbyById,
    selectItem,
    clearSelection,
    loadGlobalConfig,
    refreshGlobal,
    saveToGlobal,
    saveLobbiesToGlobal,
    backupToKv,
    newConfig,
    addJump,
    addLobbyJump,
    addJumpFromUrl,
    importConfig,
    exportConfig,
    updateSelected,
    updateSelectedLobby,
    resetSelectedLobby,
    setArgs,
    duplicateSelected,
    deleteSelected,
    jumpSelected,
    closeIframe,
  }
}

export type JumpStore = ReturnType<typeof useJumpStore>
