<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { Delete, Position } from '@element-plus/icons-vue'
import type { JumpStore } from '../composables/useJumpStore'
import type { ArgRow, OpenMode } from '../types/jump'

const props = defineProps<{
  store: JumpStore
}>()

const nameInput = ref<{ focus: () => void; select?: () => void } | null>(null)

const argRows = ref<ArgRow[]>([])

const item = computed(() => props.store.selectedItem.value)

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
</script>

<template>
  <aside
    class="flex w-80 shrink-0 flex-col border-l border-slate-200 bg-white"
  >
    <div class="border-b border-slate-100 px-4 py-3 text-sm font-medium text-slate-700">
      属性面板
    </div>

    <div v-if="!item" class="flex flex-1 items-center justify-center px-4 text-sm text-slate-400">
      选择一个跳转进行编辑
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col">
      <div class="flex-1 space-y-4 overflow-auto p-4">
        <div>
          <label class="mb-1 block text-xs text-slate-500">名称</label>
          <el-input
            ref="nameInput"
            :model-value="item.name"
            maxlength="64"
            @update:model-value="onNameInput"
          />
        </div>

        <div>
          <label class="mb-1 block text-xs text-slate-500">打开方式</label>
          <el-radio-group :model-value="item.openMode" @update:model-value="onOpenMode">
            <el-radio-button value="tab">新标签页</el-radio-button>
            <el-radio-button value="iframe">iframe</el-radio-button>
          </el-radio-group>
        </div>

        <div>
          <label class="mb-1 block text-xs text-slate-500">图标 URL</label>
          <el-input
            :model-value="item.iconUrl"
            placeholder="https://..."
            @update:model-value="onIconUrl"
          />
        </div>

        <div>
          <label class="mb-1 block text-xs text-slate-500">跳转地址</label>
          <el-input
            :model-value="item.url"
            placeholder="https://..."
            @update:model-value="onUrl"
          />
        </div>

        <div>
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
      </div>

      <div class="flex gap-2 border-t border-slate-100 p-4">
        <el-button type="primary" class="flex-1" :icon="Position" @click="store.jumpSelected()">
          跳转
        </el-button>
        <el-button type="danger" plain class="flex-1" :icon="Delete" @click="store.deleteSelected()">
          删除
        </el-button>
      </div>
    </div>
  </aside>
</template>
