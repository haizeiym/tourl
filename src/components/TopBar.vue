<script setup lang="ts">
import { DocumentAdd, Download, FolderOpened, Plus } from '@element-plus/icons-vue'
import { ref } from 'vue'
import type { JumpStore } from '../composables/useJumpStore'

const props = defineProps<{
  store: JumpStore
}>()

const fileInput = ref<HTMLInputElement | null>(null)

function onPickFile() {
  fileInput.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await props.store.importConfig(file)
}
</script>

<template>
  <header
    class="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4"
  >
    <div class="mr-4 text-base font-semibold tracking-tight text-slate-800">
      URL 跳转工具
    </div>
    <el-button :icon="DocumentAdd" @click="store.newConfig()">新建配置</el-button>
    <el-button :icon="FolderOpened" @click="onPickFile">导入配置</el-button>
    <el-button :icon="Download" @click="store.exportConfig()">导出配置</el-button>
    <el-button type="primary" :icon="Plus" @click="store.addJump()">新建跳转</el-button>
    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="onFileChange"
    />
  </header>
</template>
