<script setup lang="ts">
import { Back } from '@element-plus/icons-vue'
import type { JumpStore } from '../composables/useJumpStore'

defineProps<{
  store: JumpStore
}>()
</script>

<template>
  <section class="relative flex min-h-0 flex-1 flex-col bg-slate-100">
    <div
      class="flex h-12 shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-4"
    >
      <el-button :icon="Back" @click="store.closeIframe()">关闭预览 / 返回列表</el-button>
      <span class="truncate text-xs text-slate-400">{{ store.iframeSrc.value }}</span>
    </div>
    <iframe
      v-if="store.iframeSrc.value"
      :src="store.iframeSrc.value"
      class="h-full w-full flex-1 border-0 bg-white"
      title="jump-preview"
    />
  </section>
</template>
