<script setup lang="ts">
import {
  ArrowDown,
  Collection,
  DocumentAdd,
  Download,
  CircleCheck,
  FolderOpened,
  Link,
  Location,
  Plus,
  Refresh,
  Upload,
} from '@element-plus/icons-vue'
import { computed, ref } from 'vue'
import type { JumpStore } from '../composables/useJumpStore'
import type { LayoutStore } from '../composables/useLayoutStore'
import type { ToolbarId } from '../types/layout'

const props = defineProps<{
  store: JumpStore
  layout: LayoutStore
  isMobile: boolean
}>()

const fileInput = ref<HTMLInputElement | null>(null)
const dragToolbarId = ref<string | null>(null)

function onPickFile() {
  fileInput.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await props.store.importConfig(file)
}

function onMoreCommand(cmd: string | number | object) {
  const key = String(cmd)
  if (key === 'backup') void props.store.backupToKv()
  if (key === 'lobby') props.store.addLobbyJump()
  if (key === 'newConfig') void props.store.newConfig()
  if (key === 'import') onPickFile()
  if (key === 'export') props.store.exportConfig()
  if (key === 'fromUrl') void props.store.addJumpFromUrl()
  if (key === 'loadLayout') void props.layout.loadLayout()
  if (key === 'saveLayout') void props.layout.saveLayout()
}

function onToolbarDragStart(id: string, e: DragEvent) {
  dragToolbarId.value = id
  e.dataTransfer?.setData('text/plain', id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onToolbarDrop(id: string, e: DragEvent) {
  e.preventDefault()
  const from = dragToolbarId.value || e.dataTransfer?.getData('text/plain')
  dragToolbarId.value = null
  if (from) props.layout.reorderToolbar(from, id)
}

const kindOptions = computed(() =>
  props.layout.kindOptions(props.store.config.value.items),
)

function onKindFilter(v: string | number | boolean | undefined) {
  props.layout.kindFilter.value = String(v ?? 'all')
}

function runToolbar(id: ToolbarId) {
  const s = props.store
  const l = props.layout
  if (id === 'saveGlobal') void s.saveToGlobal()
  if (id === 'saveLobby') void s.saveLobbiesToGlobal()
  if (id === 'refresh') void s.refreshGlobal()
  if (id === 'backup') void s.backupToKv()
  if (id === 'addJump') s.addJump()
  if (id === 'addLobby') s.addLobbyJump()
  if (id === 'fromUrl') void s.addJumpFromUrl()
  if (id === 'newConfig') void s.newConfig()
  if (id === 'import') onPickFile()
  if (id === 'export') s.exportConfig()
  if (id === 'loadLayout') void l.loadLayout()
  if (id === 'saveLayout') void l.saveLayout()
}
</script>

<template>
  <header
    class="flex shrink-0 flex-col gap-2 border-b border-slate-200 bg-white px-3 py-2 md:px-4"
  >
    <div class="flex min-w-0 items-center gap-2">
      <div class="shrink-0 text-sm font-semibold tracking-tight text-slate-800 md:text-base">
        URL 跳转
      </div>
      <el-select
        :model-value="layout.kindFilter.value"
        class="!w-28"
        size="small"
        @update:model-value="onKindFilter"
      >
        <el-option
          v-for="opt in kindOptions"
          :key="opt.value"
          :label="opt.label"
          :value="opt.value"
        />
      </el-select>
      <span v-if="store.dirty.value" class="shrink-0 text-xs text-amber-600">未保存</span>
      <span v-if="store.lobbyDirty.value" class="shrink-0 text-xs text-orange-600">大厅未保存</span>
      <span v-if="layout.layoutDirty.value" class="shrink-0 text-xs text-sky-600">位置未保存</span>
    </div>

    <!-- 桌面：两行可换行，可拖动按钮顺序 -->
    <div
      v-if="!isMobile"
      class="flex max-h-[5.5rem] flex-wrap content-start gap-1.5 overflow-y-auto"
    >
      <span
        v-for="id in layout.toolbarIds.value"
        :key="id"
        class="inline-flex"
        draggable="true"
        @dragstart="onToolbarDragStart(id, $event)"
        @dragover.prevent
        @drop="onToolbarDrop(id, $event)"
      >
        <el-button
          v-if="id === 'saveGlobal'"
          type="success"
          size="small"
          :icon="Upload"
          :loading="store.saving.value"
          @click="runToolbar(id)"
        >保存到全局</el-button>
        <el-button
          v-else-if="id === 'saveLobby'"
          type="warning"
          size="small"
          :icon="Upload"
          :loading="store.savingLobby.value"
          @click="runToolbar(id)"
        >保存大厅全局</el-button>
        <el-button
          v-else-if="id === 'refresh'"
          size="small"
          :icon="Refresh"
          :loading="store.loading.value"
          @click="runToolbar(id)"
        >刷新全局</el-button>
        <el-button
          v-else-if="id === 'backup'"
          size="small"
          :icon="Collection"
          :loading="store.backingUp.value"
          @click="runToolbar(id)"
        >备份</el-button>
        <el-button
          v-else-if="id === 'addJump'"
          type="primary"
          size="small"
          :icon="Plus"
          @click="runToolbar(id)"
        >新建跳转</el-button>
        <el-button
          v-else-if="id === 'addLobby'"
          type="warning"
          plain
          size="small"
          :icon="Plus"
          @click="runToolbar(id)"
        >新建大厅</el-button>
        <el-button
          v-else-if="id === 'fromUrl'"
          size="small"
          :icon="Link"
          @click="runToolbar(id)"
        >根据 URL 添加</el-button>
        <el-button
          v-else-if="id === 'newConfig'"
          size="small"
          :icon="DocumentAdd"
          @click="runToolbar(id)"
        >新建配置</el-button>
        <el-button
          v-else-if="id === 'import'"
          size="small"
          :icon="FolderOpened"
          @click="runToolbar(id)"
        >导入配置</el-button>
        <el-button
          v-else-if="id === 'export'"
          size="small"
          :icon="Download"
          @click="runToolbar(id)"
        >导出配置</el-button>
        <el-button
          v-else-if="id === 'loadLayout'"
          size="small"
          :icon="Location"
          :loading="layout.loadingLayout.value"
          @click="runToolbar(id)"
        >读取位置</el-button>
        <el-button
          v-else-if="id === 'saveLayout'"
          size="small"
          :icon="CircleCheck"
          :loading="layout.savingLayout.value"
          @click="runToolbar(id)"
        >保存位置</el-button>
      </span>
    </div>

    <div v-else class="flex min-w-0 flex-wrap items-center gap-1.5">
      <el-button
        type="success"
        size="small"
        :icon="Upload"
        :loading="store.saving.value"
        @click="store.saveToGlobal()"
      >保存</el-button>
      <el-button
        type="warning"
        size="small"
        :icon="Upload"
        :loading="store.savingLobby.value"
        @click="store.saveLobbiesToGlobal()"
      >大厅</el-button>
      <el-button
        size="small"
        :icon="Refresh"
        :loading="store.loading.value"
        @click="store.refreshGlobal()"
      />
      <el-button size="small" type="primary" :icon="Plus" @click="store.addJump()">新建</el-button>
      <el-dropdown trigger="click" @command="onMoreCommand">
        <el-button size="small">
          更多
          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="loadLayout" :icon="Location">读取位置</el-dropdown-item>
            <el-dropdown-item command="saveLayout" :icon="CircleCheck">保存位置</el-dropdown-item>
            <el-dropdown-item command="backup" :icon="Collection">备份</el-dropdown-item>
            <el-dropdown-item command="lobby" :icon="Plus">新建大厅</el-dropdown-item>
            <el-dropdown-item command="fromUrl" :icon="Link">根据 URL 添加</el-dropdown-item>
            <el-dropdown-item command="newConfig" :icon="DocumentAdd">新建配置</el-dropdown-item>
            <el-dropdown-item command="import" :icon="FolderOpened">导入配置</el-dropdown-item>
            <el-dropdown-item command="export" :icon="Download">导出配置</el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="onFileChange"
    />
  </header>
</template>
