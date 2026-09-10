<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { JumpStore } from '../composables/useJumpStore'
import type { LayoutStore } from '../composables/useLayoutStore'
import JumpCard from './JumpCard.vue'

const props = defineProps<{
  store: JumpStore
  layout: LayoutStore
  isMobile?: boolean
}>()

const dragId = ref<string | null>(null)

watch(
  () => props.store.config.value.items.map((i) => i.id).join(','),
  () => {
    props.layout.syncItemOrder(props.store.config.value.items)
  },
  { immediate: true },
)

const items = computed(() =>
  props.layout.visibleItems(props.store.config.value.items),
)

function onDragStart(id: string, e: DragEvent) {
  dragId.value = id
  e.dataTransfer?.setData('text/plain', id)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
}

function onDrop(id: string, e: DragEvent) {
  e.preventDefault()
  const from = dragId.value || e.dataTransfer?.getData('text/plain')
  dragId.value = null
  if (from) props.layout.reorderItems(from, id)
}
</script>

<template>
  <section class="min-h-0 flex-1 overflow-auto bg-slate-50 p-3 md:p-4">
    <div
      v-if="items.length === 0"
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
        v-for="item in items"
        :key="item.id"
        :item="item"
        :selected="store.selectedId.value === item.id"
        :compact="Boolean(isMobile)"
        draggable
        @select="store.selectItem"
        @drag-start="onDragStart"
        @drop-on="onDrop"
      />
    </div>
  </section>
</template>
