import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { JumpConfigFile, JumpItem, LobbyConfig, LobbyUserAccount } from '../types/jump'
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
  MAX_MULTI_TAB_COUNT,
  type WindowGridRect,
  clampMultiTabCount,
  computeChromeGridRects,
  createDefaultLobbyConfig,
  createLobbyJumpItem,
  deduplicateLobbyAccounts,
  ensureLocalLobbyUser,
  ensureLocalLobbyUsers,
  executeLobbyJump,
  lobbyForSharedStore,
  parseLobbyConfig,
  regenerateAccountField,
  regenerateAllAccounts,
  writeLocalLobbyUser,
  writeRawLocalUsers,
} from '../utils/lobby'

function readInitialPreviewUrl(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const sp = new URLSearchParams(window.location.search)
    const raw = sp.get('preview')?.trim() ?? ''
    if (!isHttpUrl(raw)) return null
    const wx = Number(sp.get('wx'))
    const wy = Number(sp.get('wy'))
    const ww = Number(sp.get('ww'))
    const wh = Number(sp.get('wh'))
    if (Number.isFinite(ww) && Number.isFinite(wh) && ww >= 200 && wh >= 200) {
      try {
        window.resizeTo(Math.round(ww), Math.round(wh))
      } catch {
        /* ignore */
      }
    }
    if (Number.isFinite(wx) && Number.isFinite(wy)) {
      try {
        window.moveTo(Math.round(wx), Math.round(wy))
      } catch {
        /* ignore */
      }
    }
    return raw
  } catch {
    return null
  }
}

export function buildPreviewTabUrl(targetUrl: string, rect?: WindowGridRect): string {
  const u = new URL(window.location.href)
  u.search = ''
  u.hash = ''
  u.searchParams.set('preview', targetUrl)
  if (rect) {
    u.searchParams.set('wx', String(rect.left))
    u.searchParams.set('wy', String(rect.top))
    u.searchParams.set('ww', String(rect.width))
    u.searchParams.set('wh', String(rect.height))
  }
  return u.toString()
}

export type MultiGridPane = {
  uuid: string
  nickname: string
  url: string
}

const LS_MULTI_GRID_PREFIX = 'jumpl.multiGrid.'

function readInitialMultiGridPanes(): MultiGridPane[] {
  if (typeof window === 'undefined') return []
  try {
    const key = new URLSearchParams(window.location.search).get('multiGrid')?.trim() ?? ''
    if (!key) return []
    const raw = localStorage.getItem(`${LS_MULTI_GRID_PREFIX}${key}`)
    if (!raw) return []
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr.filter(
      (p): p is MultiGridPane =>
        Boolean(p) &&
        typeof p === 'object' &&
        typeof (p as MultiGridPane).url === 'string' &&
        isHttpUrl((p as MultiGridPane).url),
    )
  } catch {
    return []
  }
}

export function buildMultiGridTabUrl(panes: MultiGridPane[]): string {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  try {
    localStorage.setItem(`${LS_MULTI_GRID_PREFIX}${stamp}`, JSON.stringify(panes))
  } catch {
    /* ignore */
  }
  const u = new URL(window.location.href)
  u.search = ''
  u.hash = ''
  u.searchParams.set('multiGrid', stamp)
  return u.toString()
}

export function useJumpStore() {
  const initialPreview = readInitialPreviewUrl()
  const initialMultiGrid = readInitialMultiGridPanes()
  const config = ref<JumpConfigFile>(createEmptyConfig())
  const selectedId = ref<string | null>(null)
  const dirty = ref(false)
  const lobbyDirty = ref(false)
  const iframeSrc = ref<string | null>(initialPreview)
  const multiGridPanes = ref<MultiGridPane[]>(initialMultiGrid)
  const isStandaloneTab = ref(Boolean(initialPreview || initialMultiGrid.length > 0))
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
  const isMultiGridPreview = computed(() => multiGridPanes.value.length > 0)

  function markDirty() {
    dirty.value = true
  }

  function markLobbyDirty() {
    lobbyDirty.value = true
  }

  function applyLocalUserToAllLobbies() {
    const user = ensureLocalLobbyUser()
    const accounts = ensureLocalLobbyUsers(MAX_MULTI_TAB_COUNT)
    for (const id of Object.keys(lobbyById)) {
      lobbyById[id] = {
        ...lobbyById[id]!,
        ...user,
        accounts: accounts.map((a) => ({ ...a })),
      }
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
    if (!isStandaloneTab.value) {
      closeIframe()
    }
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
    const { uuid, nickname, accounts, ...shared } = patch
    if (uuid !== undefined || nickname !== undefined) {
      const nextPrimary = writeLocalLobbyUser({ uuid, nickname })
      const allAccounts = ensureLocalLobbyUsers(MAX_MULTI_TAB_COUNT)
      allAccounts[0] = { uuid: nextPrimary.uuid, nickname: nextPrimary.nickname }
      writeRawLocalUsers(allAccounts)
      applyLocalUserToAllLobbies()
    }
    if (accounts !== undefined) {
      writeRawLocalUsers(accounts)
      if (accounts[0]) {
        writeLocalLobbyUser(accounts[0])
      }
      applyLocalUserToAllLobbies()
    }
    if (Object.keys(shared).length === 0) return
    const current = lobbyById[item.id] ?? createDefaultLobbyConfig()
    if (shared.multiTabCount !== undefined) {
      shared.multiTabCount = clampMultiTabCount(shared.multiTabCount)
    }
    lobbyById[item.id] = {
      ...current,
      ...shared,
      ...ensureLocalLobbyUser(),
      accounts: ensureLocalLobbyUsers(MAX_MULTI_TAB_COUNT),
    }
    markLobbyDirty()
  }

  function updateLobbyAccount(index: number, patch: Partial<LobbyUserAccount>) {
    const item = selectedItem.value
    if (!item || item.kind !== 'lobby') return
    const current = lobbyById[item.id] ?? createDefaultLobbyConfig()
    const list = (current.accounts ?? ensureLocalLobbyUsers(MAX_MULTI_TAB_COUNT)).map((a) => ({ ...a }))
    while (list.length <= index) {
      list.push({ uuid: '', nickname: '' })
    }
    list[index] = {
      uuid: patch.uuid !== undefined ? patch.uuid : list[index]!.uuid,
      nickname: patch.nickname !== undefined ? patch.nickname : list[index]!.nickname,
    }
    writeRawLocalUsers(list)
    if (index === 0 && list[0]) {
      writeLocalLobbyUser(list[0])
    }
    for (const id of Object.keys(lobbyById)) {
      lobbyById[id] = {
        ...lobbyById[id]!,
        uuid: list[0]?.uuid || lobbyById[id]!.uuid,
        nickname: list[0]?.nickname || lobbyById[id]!.nickname,
        accounts: list.map((a) => ({ ...a })),
      }
    }
  }

  function regenerateLobbyAccountField(index: number, field: 'uuid' | 'nickname') {
    const item = selectedItem.value
    if (!item || item.kind !== 'lobby') return
    const current = lobbyById[item.id] ?? createDefaultLobbyConfig()
    const list = current.accounts ?? ensureLocalLobbyUsers(MAX_MULTI_TAB_COUNT)
    const next = regenerateAccountField(list, index, field)
    for (const id of Object.keys(lobbyById)) {
      lobbyById[id] = {
        ...lobbyById[id]!,
        uuid: next[0]?.uuid || lobbyById[id]!.uuid,
        nickname: next[0]?.nickname || lobbyById[id]!.nickname,
        accounts: next.map((a) => ({ ...a })),
      }
    }
  }

  function regenerateAllLobbyAccounts() {
    const item = selectedItem.value
    if (!item || item.kind !== 'lobby') return
    const current = lobbyById[item.id] ?? createDefaultLobbyConfig()
    const count = clampMultiTabCount(current.multiTabCount)
    const next = regenerateAllAccounts(Math.max(count, MAX_MULTI_TAB_COUNT))
    for (const id of Object.keys(lobbyById)) {
      lobbyById[id] = {
        ...lobbyById[id]!,
        uuid: next[0]?.uuid || lobbyById[id]!.uuid,
        nickname: next[0]?.nickname || lobbyById[id]!.nickname,
        accounts: next.map((a) => ({ ...a })),
      }
    }
    ElMessage.success(`已重新随机生成 ${count} 个互不重复的账号`)
  }

  function deduplicateSelectedLobbyAccounts() {
    const item = selectedItem.value
    if (!item || item.kind !== 'lobby') return
    const current = lobbyById[item.id] ?? createDefaultLobbyConfig()
    const count = clampMultiTabCount(current.multiTabCount)
    const next = deduplicateLobbyAccounts(current.accounts ?? [], Math.max(count, MAX_MULTI_TAB_COUNT))
    writeRawLocalUsers(next)
    if (next[0]) {
      writeLocalLobbyUser(next[0])
    }
    for (const id of Object.keys(lobbyById)) {
      lobbyById[id] = {
        ...lobbyById[id]!,
        uuid: next[0]?.uuid || lobbyById[id]!.uuid,
        nickname: next[0]?.nickname || lobbyById[id]!.nickname,
        accounts: next.map((a) => ({ ...a })),
      }
    }
    ElMessage.success('已自动去重所有账号 UUID 与昵称')
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
          multiTabCount: srcLobby.multiTabCount,
          accounts: srcLobby.accounts?.map((a) => ({ ...a })),
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
    if (isStandaloneTab.value) {
      isStandaloneTab.value = false
      try {
        window.history.replaceState(null, '', window.location.pathname)
      } catch {
        /* ignore */
      }
      try {
        window.close()
      } catch {
        /* ignore */
      }
    }
    iframeSrc.value = null
  }

  function closeMultiGrid() {
    multiGridPanes.value = []
    if (isStandaloneTab.value) {
      isStandaloneTab.value = false
      try {
        window.history.replaceState(null, '', window.location.pathname)
      } catch {
        /* ignore */
      }
      try {
        window.close()
      } catch {
        /* ignore */
      }
    }
  }

  /**
   * 同步打开新标签页（必须在用户点击的同步调用栈内执行，否则 iOS Safari 会拦截）。
   * 注意：features 中带 noopener 时 window.open 恒返回 null，因此改为手动断开 opener。
   */
  function openBlankTab(url = ''): Window | null {
    const win = window.open(url || 'about:blank', '_blank')
    if (win) {
      try {
        win.opener = null
      } catch {
        /* ignore */
      }
    }
    return win
  }

  /**
   * 针对 Chrome / Edge 同步打开带均匀网格坐标的独立标签窗口
   */
  function openTiledChromeWindow(
    slotIndex: number,
    rect: WindowGridRect,
    account: LobbyUserAccount,
  ): Window | null {
    const features = [
      'popup=yes',
      `left=${rect.left}`,
      `top=${rect.top}`,
      `width=${rect.width}`,
      `height=${rect.height}`,
      'resizable=yes',
      'scrollbars=yes',
    ].join(',')

    const win = window.open('about:blank', `jumpl_lobby_slot_${slotIndex}`, features)
    if (!win) return null

    try {
      win.resizeTo(rect.width, rect.height)
      win.moveTo(rect.left, rect.top)
    } catch {
      /* ignore */
    }

    try {
      win.document.open()
      win.document.write(
        `<!doctype html><html><head><meta charset="utf-8"><title>账号 #${slotIndex + 1} - ${account.nickname}</title></head>` +
          `<body style="margin:0;height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;background:#0f172a;color:#e2e8f0;font-family:system-ui,sans-serif;font-size:13px;">` +
          `<div style="margin-bottom:8px;font-weight:600;color:#38bdf8;">窗口 #${slotIndex + 1} (${rect.width}×${rect.height})</div>` +
          `<div>正在创建并登录账号：<b>${account.nickname}</b> (UUID: <code>${account.uuid}</code>)...</div>` +
          `</body></html>`,
      )
      win.document.close()
    } catch {
      /* ignore */
    }

    return win
  }

  async function jumpSelected() {
    const item = selectedItem.value
    if (!item) return

    if (item.kind === 'lobby') {
      const lobby = lobbyById[item.id] ?? createDefaultLobbyConfig()

      // 多标签打开模式（Chrome / Edge 多账号并发创建 + 窗口均匀排列）
      if (item.openMode === 'multi-tab') {
        const count = clampMultiTabCount(lobby.multiTabCount)
        const dedupedAll = deduplicateLobbyAccounts(
          lobby.accounts ?? ensureLocalLobbyUsers(MAX_MULTI_TAB_COUNT),
          Math.max(count, MAX_MULTI_TAB_COUNT),
        )
        writeRawLocalUsers(dedupedAll)
        if (dedupedAll[0]) writeLocalLobbyUser(dedupedAll[0])
        applyLocalUserToAllLobbies()

        const activeAccounts = dedupedAll.slice(0, count)
        const rects = computeChromeGridRects(count)

        // 在用户点击的同步调用栈内一次性尝试打开 N 个均匀排布的 Chrome/Edge 独立窗口
        const preWins = activeAccounts.map((acc, idx) =>
          openTiledChromeWindow(idx, rects[idx]!, acc),
        )
        const openedCount = preWins.filter((w) => w !== null).length
        const allPopupsOpened = openedCount === count

        jumping.value = true
        try {
          // 并发创建并登录全部 N 个互不重复的账号
          const results = await Promise.all(
            activeAccounts.map(async (acc) => {
              const { finalUrl } = await executeLobbyJump({
                ...lobby,
                uuid: acc.uuid,
                nickname: acc.nickname,
              })
              return {
                uuid: acc.uuid,
                nickname: acc.nickname,
                url: finalUrl,
              }
            }),
          )

          if (allPopupsOpened) {
            // 模式 1：Chrome/Edge 允许弹出全部独立窗口，分别导航到各自均匀排布的独立窗口
            results.forEach((pane, idx) => {
              const win = preWins[idx]
              const rect = rects[idx]!
              if (!win || win.closed) return
              win.location.href = buildPreviewTabUrl(pane.url, rect)
              try {
                win.resizeTo(rect.width, rect.height)
                win.moveTo(rect.left, rect.top)
              } catch {
                /* ignore */
              }
            })
            ElMessage.success(`已创建并打开 ${count} 个不重复账号，独立窗口已均匀排列`)
            return
          }

          // 模式 2：Chrome/Edge 默认拦截了第 2 个及以后的弹窗 → 自动切换为同窗均匀多宫格排列（100% 全部打开）
          for (let i = 1; i < preWins.length; i += 1) {
            try {
              preWins[i]?.close()
            } catch {
              /* ignore */
            }
          }
          const primaryWin = preWins[0]
          if (primaryWin && !primaryWin.closed) {
            const scr = window.screen as Screen & { availLeft?: number; availTop?: number }
            const availLeft = typeof scr.availLeft === 'number' ? scr.availLeft : 0
            const availTop = typeof scr.availTop === 'number' ? scr.availTop : 0
            const availW = scr.availWidth || scr.width || 1440
            const availH = scr.availHeight || scr.height || 900
            try {
              primaryWin.moveTo(availLeft, availTop)
              primaryWin.resizeTo(availW, availH)
            } catch {
              /* ignore */
            }
            primaryWin.location.href = buildMultiGridTabUrl(results)
          } else {
            multiGridPanes.value = results
          }
          ElMessage.success(
            `已创建并打开 ${results.length} 个不重复账号并按网格均匀排列（若需独立系统窗口，可在顶部点「拆分为独立多窗口」）`,
          )
        } catch (err) {
          console.error('[jumpSelected] multi-tab', err)
          preWins.forEach((w) => {
            try {
              w?.close()
            } catch {
              /* ignore */
            }
          })
          ElMessage.error(err instanceof Error ? err.message : '多标签大厅跳转失败')
        } finally {
          jumping.value = false
        }
        return
      }

      // 新标签模式：在 await 之前先同步打开空白页，拿到地址后再导航到包装预览页，避免 Safari 拦截
      const preWin = item.openMode === 'iframe' ? null : openBlankTab()
      if (item.openMode !== 'iframe' && !preWin) {
        ElMessage.warning('弹窗被拦截，请允许本站打开新标签页，或改用「当前页」打开')
        return
      }
      jumping.value = true
      try {
        const { finalUrl } = await executeLobbyJump(lobby)
        if (item.openMode === 'iframe') {
          iframeSrc.value = finalUrl
          return
        }
        const wrapperUrl = buildPreviewTabUrl(finalUrl)
        if (preWin && !preWin.closed) {
          preWin.location.href = wrapperUrl
        } else if (!openBlankTab(wrapperUrl)) {
          ElMessage.warning('弹窗被拦截，请允许本站打开新标签页')
        }
      } catch (err) {
        console.error('[jumpSelected] lobby', err)
        try {
          preWin?.close()
        } catch {
          /* ignore */
        }
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

    const wrapperUrl = buildPreviewTabUrl(finalUrl)
    if (!openBlankTab(wrapperUrl)) {
      ElMessage.warning('弹窗被拦截，请允许本站打开新标签页，或改用「当前页」打开')
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
    multiGridPanes,
    isStandaloneTab,
    isIframePreview,
    isMultiGridPreview,
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
    updateLobbyAccount,
    regenerateLobbyAccountField,
    regenerateAllLobbyAccounts,
    deduplicateSelectedLobbyAccounts,
    resetSelectedLobby,
    setArgs,
    duplicateSelected,
    deleteSelected,
    jumpSelected,
    closeIframe,
    closeMultiGrid,
  }
}

export type JumpStore = ReturnType<typeof useJumpStore>
