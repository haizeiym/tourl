<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowLeft } from '@element-plus/icons-vue'
import type { JumpStore } from '../composables/useJumpStore'
import type { LayoutStore } from '../composables/useLayoutStore'
import type { InspectorFieldId } from '../types/layout'
import InspectorField from './InspectorField.vue'

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

const item = computed(() => props.store.selectedItem.value)
const isLobby = computed(() => item.value?.kind === 'lobby')

/** 仅渲染当前项可见的属性块（顺序由布局 KV 决定） */
const visibleFieldIds = computed<InspectorFieldId[]>(() =>
  props.layout.inspectorIds.value.filter((id) => fieldVisible(id)),
)

function fieldVisible(id: InspectorFieldId): boolean {
  if (id === 'url' || id === 'args') return !isLobby.value
  if (id === 'lobbyServer' || id === 'lobbyUser' || id === 'lobbyBiz' || id === 'lobbyReset') {
    return isLobby.value
  }
  return true
}

const dragFieldId = ref<string | null>(null)

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

function onDeleted() {
  if (props.isMobile) emit('back')
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
      <el-button v-if="isMobile" text :icon="ArrowLeft" @click="emit('back')">返回</el-button>
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
          v-for="fid in visibleFieldIds"
          :key="fid"
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
          <InspectorField
            class="min-w-0 flex-1"
            :store="store"
            :field-id="fid"
            @deleted="onDeleted"
          />
        </div>
      </div>
    </div>
  </aside>
</template>
