<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { ArrowLeft, CopyDocument, Delete, Position, RefreshRight } from '@element-plus/icons-vue'
import type { JumpStore } from '../composables/useJumpStore'
import type { LayoutStore } from '../composables/useLayoutStore'
import type { ArgRow, LobbyConfig, OpenMode } from '../types/jump'
import type { InspectorFieldId } from '../types/layout'
import { generateLobbyNickname, generateLobbyUuid } from '../utils/lobby'

const props = defineProps<{
  store: JumpStore
  layout: LayoutStore
  isMobile?: boolean
  /** 桌面端宽度（px），由外层拖拽控制 */
  width?: number
}>()

const emit = defineEmits<{
  back: []
}>()

const nameInput = ref<{ focus: () => void; select?: () => void } | null>(null)

const argRows = ref<ArgRow[]>([])

const item = computed(() => props.store.selectedItem.value)
const lobby = computed(() => props.store.selectedLobby.value)
const isLobby = computed(() => item.value?.kind === 'lobby')

watch(
  () => props.store.selectedId.value,
  () => {
    syncRowsFromItem()
  },
  { immediate: true },
)

watch(
  () => props.store.focusNameToken.value,
  async () => {
    await nextTick()
    nameInput.value?.focus()
    nameInput.value?.select?.()
  },
)

function syncRowsFromItem() {
  const current = props.store.selectedItem.value
  if (!current) {
    argRows.value = []
    return
  }
  argRows.value = Object.entries(current.args).map(([key, value]) => ({ key, value }))
}

function commitArgs() {
  const next: Record<string, string> = {}
  for (const row of argRows.value) {
    const k = row.key.trim()
    if (!k) continue
    next[k] = row.value
  }
  props.store.setArgs(next)
}

function addArgRow() {
  argRows.value.push({ key: '', value: '' })
}

function removeArgRow(index: number) {
  argRows.value.splice(index, 1)
  commitArgs()
}

function onNameInput(val: string) {
  props.store.updateSelected({ name: val })
}

function onOpenMode(val: OpenMode | string | number | boolean | undefined) {
  if (val === 'tab' || val === 'iframe') {
    props.store.updateSelected({ openMode: val })
  }
}

function onIconUrl(val: string) {
  props.store.updateSelected({ iconUrl: val })
}

function onUrl(val: string) {
  props.store.updateSelected({ url: val })
}

function patchLobby(patch: Partial<LobbyConfig>) {
  props.store.updateSelectedLobby(patch)
}

function onLobbyText(
  key: keyof Pick<
    LobbyConfig,
    | 'server'
    | 'appKey'
    | 'path'
    | 'uuid'
    | 'nickname'
    | 'session'
    | 'game_redirect'
  >,
  val: string | number | null | undefined,
) {
  patchLobby({ [key]: String(val ?? '') })
}

function onLobbyNumber(
  key: keyof Pick<LobbyConfig, 'channel_id' | 'merchant_id' | 'game_id'>,
  val: number | undefined | null,
) {
  if (typeof val === 'number' && Number.isFinite(val)) {
    patchLobby({ [key]: val })
  }
}

function onLobbyProtocol(
  key: 'api_protocol' | 'redirect_protocol',
  val: string | number | boolean | undefined,
) {
  if (val === 'http' || val === 'https') {
    patchLobby({ [key]: val })
  }
}


function onApiProtocol(v: string | number | boolean | undefined) {
  onLobbyProtocol('api_protocol', v)
}
function onRedirectProtocol(v: string | number | boolean | undefined) {
  onLobbyProtocol('redirect_protocol', v)
}
function onServer(v: string) { onLobbyText('server', v) }
function onAppKey(v: string) { onLobbyText('appKey', v) }
function onPath(v: string) { onLobbyText('path', v) }
function onUuid(v: string) { onLobbyText('uuid', v) }
function onNickname(v: string) { onLobbyText('nickname', v) }

function resetUuid() {
  patchLobby({ uuid: generateLobbyUuid() })
}

function resetNickname() {
  patchLobby({ nickname: generateLobbyNickname() })
}
function onSession(v: string) { onLobbyText('session', v) }
function onGameRedirect(v: string) { onLobbyText('game_redirect', v) }
function onChannelId(v: number | undefined) { onLobbyNumber('channel_id', v) }
function onMerchantId(v: number | undefined) { onLobbyNumber('merchant_id', v) }
function onGameId(v: number | undefined) { onLobbyNumber('game_id', v) }

async function onDelete() {
  await props.store.deleteSelected()
  if (props.isMobile) emit('back')
}

const dragFieldId = ref<string | null>(null)

function fieldVisible(id: InspectorFieldId): boolean {
  if (id === 'url' || id === 'args') return !isLobby.value
  if (id === 'lobbyServer' || id === 'lobbyUser' || id === 'lobbyBiz' || id === 'lobbyReset') {
    return isLobby.value
  }
  return true
}

function onFieldDragStart(id: string, e: DragEvent) {
  dragFieldId.value = id
  e.dataTransfer?.setData('text/plain', id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onFieldDrop(id: string, e: DragEvent) {
  e.preventDefault()
  const from = dragFieldId.value || e.dataTransfer?.getData('text/plain')
  dragFieldId.value = null
  if (from) props.layout.reorderInspector(from, id)
}
</script>

<template>
  <aside
    class="flex min-h-0 flex-col border-slate-200 bg-white"
    :class="isMobile ? 'w-full flex-1 border-0' : 'shrink-0 border-l'"
    :style="isMobile ? undefined : { width: `${width ?? 320}px` }"
  >
    <div
      class="flex items-center gap-2 border-b border-slate-100 px-3 py-3 text-sm font-medium text-slate-700 md:px-4"
    >
      <el-button
        v-if="isMobile"
        text
        :icon="ArrowLeft"
        @click="emit('back')"
      >
        返回
      </el-button>
      <span>属性面板</span>
      <el-tag v-if="isLobby" size="small" type="warning" class="ml-1">大厅</el-tag>
    </div>

    <div v-if="!item" class="flex flex-1 items-center justify-center px-4 text-sm text-slate-400">
      选择一个跳转进行编辑
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div class="flex-1 space-y-4 overflow-auto p-3 md:p-4">
        <p class="text-[11px] text-slate-400">拖动左侧条可调整属性显示顺序，再点「保存位置」</p>
        <div
          v-for="fid in layout.inspectorIds.value"
          :key="fid"
          v-show="fieldVisible(fid)"
          class="flex gap-1.5 rounded border border-transparent hover:border-slate-200"
          @dragover.prevent
          @drop="onFieldDrop(fid, $event)"
        >
          <span
            class="mt-1 h-8 w-1.5 shrink-0 cursor-grab rounded bg-slate-300 active:cursor-grabbing"
            draggable="true"
            title="拖动调整顺序"
            @dragstart="onFieldDragStart(fid, $event)"
          />
          <div class="min-w-0 flex-1">
          <div v-if="fid === 'name'">
            <label class="mb-1 block text-xs text-slate-500">名称</label>
            <el-input
              ref="nameInput"
              :model-value="item.name"
              maxlength="64"
              @update:model-value="onNameInput"
            />
          </div>

          <div v-else-if="fid === 'openMode'">
            <label class="mb-1 block text-xs text-slate-500">打开方式</label>
            <el-radio-group :model-value="item.openMode" @update:model-value="onOpenMode">
              <el-radio-button value="tab">新标签页</el-radio-button>
              <el-radio-button value="iframe">当前页</el-radio-button>
            </el-radio-group>
          </div>

          <div v-else-if="fid === 'iconUrl'">
            <label class="mb-1 block text-xs text-slate-500">图标 URL</label>
            <el-input
              :model-value="item.iconUrl"
              placeholder="https://..."
              @update:model-value="onIconUrl"
            />
          </div>

          <div v-else-if="fid === 'url'">
            <label class="mb-1 block text-xs text-slate-500">跳转地址</label>
            <el-input
              :model-value="item.url"
              placeholder="https://..."
              @update:model-value="onUrl"
            />
          </div>

          <div v-else-if="fid === 'args'">
            <div class="mb-2 flex items-center justify-between">
              <label class="text-xs text-slate-500">参数</label>
              <el-button size="small" @click="addArgRow">添加参数</el-button>
            </div>
            <div v-if="argRows.length === 0" class="text-xs text-slate-400">暂无参数</div>
            <div v-for="(row, index) in argRows" :key="index" class="mb-2 flex gap-2">
              <el-input
                v-model="row.key"
                placeholder="key"
                class="flex-1"
                @change="commitArgs"
              />
              <el-input
                v-model="row.value"
                placeholder="value"
                class="flex-1"
                @change="commitArgs"
              />
              <el-button :icon="Delete" @click="removeArgRow(index)" />
            </div>
          </div>

          <div v-else-if="fid === 'lobbyServer' && lobby" class="space-y-3">
            <div class="text-xs font-medium text-slate-600">服务器配置</div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="mb-1 block text-xs text-slate-500">接口协议</label>
                <el-select
                  :model-value="lobby.api_protocol"
                  class="w-full"
                  @update:model-value="onApiProtocol"
                >
                  <el-option label="http" value="http" />
                  <el-option label="https" value="https" />
                </el-select>
              </div>
              <div>
                <label class="mb-1 block text-xs text-slate-500">服务器地址</label>
                <el-input
                  :model-value="lobby.server"
                  placeholder="gws-westpool.ht666.xyz"
                  @update:model-value="onServer"
                />
              </div>
            </div>
            <div>
              <label class="mb-1 block text-xs text-slate-500">签名密钥 (appKey)</label>
              <el-input
                :model-value="lobby.appKey"
                placeholder="appKey"
                @update:model-value="onAppKey"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-slate-500">接口路径 (path)</label>
              <el-input
                :model-value="lobby.path"
                placeholder="/api/v1/game/login"
                @update:model-value="onPath"
              />
            </div>
          </div>

          <div v-else-if="fid === 'lobbyUser' && lobby" class="space-y-3">
            <div class="text-xs font-medium text-slate-600">用户信息</div>
            <div>
              <label class="mb-1 block text-xs text-slate-500">用户 UUID</label>
              <div class="flex gap-2">
                <el-input
                  class="flex-1"
                  :model-value="lobby.uuid"
                  @update:model-value="onUuid"
                />
                <el-button :icon="RefreshRight" @click="resetUuid">重置</el-button>
              </div>
            </div>
            <div>
              <label class="mb-1 block text-xs text-slate-500">昵称</label>
              <div class="flex gap-2">
                <el-input
                  class="flex-1"
                  :model-value="lobby.nickname"
                  @update:model-value="onNickname"
                />
                <el-button :icon="RefreshRight" @click="resetNickname">重置</el-button>
              </div>
            </div>
            <div>
              <label class="mb-1 block text-xs text-slate-500">会话 (session)</label>
              <el-input
                :model-value="lobby.session"
                @update:model-value="onSession"
              />
            </div>
          </div>

          <div v-else-if="fid === 'lobbyBiz' && lobby" class="space-y-3">
            <div class="text-xs font-medium text-slate-600">业务参数</div>
            <div>
              <label class="mb-1 block text-xs text-slate-500">渠道 ID</label>
              <el-input-number
                class="!w-full"
                :model-value="lobby.channel_id"
                :controls="false"
                @update:model-value="onChannelId"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-slate-500">商户 ID</label>
              <el-input-number
                class="!w-full"
                :model-value="lobby.merchant_id"
                :controls="false"
                @update:model-value="onMerchantId"
              />
            </div>
            <div>
              <label class="mb-1 block text-xs text-slate-500">游戏 ID</label>
              <el-input-number
                class="!w-full"
                :model-value="lobby.game_id"
                :controls="false"
                @update:model-value="onGameId"
              />
            </div>
            <div class="grid grid-cols-2 gap-2">
              <div>
                <label class="mb-1 block text-xs text-slate-500">跳转协议</label>
                <el-select
                  :model-value="lobby.redirect_protocol"
                  class="w-full"
                  @update:model-value="onRedirectProtocol"
                >
                  <el-option label="http" value="http" />
                  <el-option label="https" value="https" />
                </el-select>
              </div>
              <div>
                <label class="mb-1 block text-xs text-slate-500">游戏跳转地址</label>
                <el-input
                  :model-value="lobby.game_redirect"
                  placeholder="localhost:7456"
                  @update:model-value="onGameRedirect"
                />
              </div>
            </div>
          </div>

          <el-button
            v-else-if="fid === 'lobbyReset'"
            class="w-full"
            :icon="RefreshRight"
            @click="store.resetSelectedLobby()"
          >
            重置大厅默认参数
          </el-button>

          <el-button
            v-else-if="fid === 'duplicate'"
            class="w-full"
            :icon="CopyDocument"
            @click="store.duplicateSelected()"
          >
            复制当前配置
          </el-button>


          <el-button
            v-else-if="fid === 'jump'"
            type="primary"
            class="w-full"
            :icon="Position"
            :loading="store.jumping.value"
            @click="store.jumpSelected()"
          >
            跳转
          </el-button>

          <el-button
            v-else-if="fid === 'delete'"
            type="danger"
            plain
            class="w-full"
            :icon="Delete"
            @click="onDelete"
          >
            删除
          </el-button>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>
