<script setup lang="ts">
import { ref, watch } from 'vue'
import type { JumpItem } from '../types/jump'
import { displayInitial } from '../utils/jump'

const props = defineProps<{
  item: JumpItem
  selected: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const imgFailed = ref(false)

watch(
  () => props.item.iconUrl,
  () => {
    imgFailed.value = false
  },
)

const showImg = () => Boolean(props.item.iconUrl) && !imgFailed.value
</script>

<template>
  <button
    type="button"
    class="flex w-full flex-col items-center gap-2 rounded-lg border-2 bg-white p-3 text-center transition hover:border-blue-300 hover:shadow-sm"
    :class="selected ? 'border-blue-500 shadow-sm' : 'border-transparent'"
    @click="emit('select', item.id)"
  >
    <div
      class="flex h-16 w-16 items-center justify-center overflow-hidden rounded-xl bg-slate-100 text-xl font-semibold text-slate-600"
    >
      <img
        v-if="showImg()"
        :src="item.iconUrl"
        :alt="item.name"
        class="h-full w-full object-cover"
        @error="imgFailed = true"
      />
      <span v-else>{{ displayInitial(item.name) }}</span>
    </div>
    <div class="w-full truncate text-sm text-slate-700" :title="item.name">
      {{ item.name || '未命名' }}
    </div>
  </button>
</template>
