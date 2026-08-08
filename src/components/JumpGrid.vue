<script setup lang="ts">
import type { JumpStore } from '../composables/useJumpStore'
import JumpCard from './JumpCard.vue'

defineProps<{
  store: JumpStore
  isMobile?: boolean
}>()
</script>

<template>
  <section class="min-h-0 flex-1 overflow-auto bg-slate-50 p-3 md:p-4">
    <div
      v-if="store.config.value.items.length === 0"
      class="flex h-full min-h-48 items-center justify-center px-4 text-center text-sm text-slate-400 md:text-base"
    >
      暂无跳转，点击「新建」开始
    </div>
    <div
      v-else
      class="grid items-start gap-2 md:gap-3"
      :style="{
        gridTemplateColumns: isMobile
          ? 'repeat(auto-fill, minmax(96px, 1fr))'
          : 'repeat(auto-fill, minmax(120px, 1fr))',
      }"
    >
      <JumpCard
        v-for="item in store.config.value.items"
        :key="item.id"
        :item="item"
        :selected="store.selectedId.value === item.id"
        :compact="Boolean(isMobile)"
        @select="store.selectItem"
      />
    </div>
  </section>
</template>
