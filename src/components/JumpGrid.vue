<script setup lang="ts">
import type { JumpStore } from '../composables/useJumpStore'
import JumpCard from './JumpCard.vue'

defineProps<{
  store: JumpStore
}>()
</script>

<template>
  <section class="min-h-0 flex-1 overflow-auto bg-slate-50 p-4">
    <div
      v-if="store.config.value.items.length === 0"
      class="flex h-full min-h-48 items-center justify-center text-slate-400"
    >
      暂无跳转，点击「新建跳转」开始
    </div>
    <div
      v-else
      class="grid gap-3"
      style="grid-template-columns: repeat(auto-fill, minmax(120px, 1fr))"
    >
      <JumpCard
        v-for="item in store.config.value.items"
        :key="item.id"
        :item="item"
        :selected="store.selectedId.value === item.id"
        @select="store.selectItem"
      />
    </div>
  </section>
</template>
