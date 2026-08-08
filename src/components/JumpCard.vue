<script setup lang="ts">
import { ref, watch } from 'vue'
import type { JumpItem } from '../types/jump'
import { displayInitial } from '../utils/jump'

const props = defineProps<{
  item: JumpItem
  selected: boolean
  compact?: boolean
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
    class="flex w-full flex-col items-center text-center transition hover:border-blue-300 hover:shadow-sm"
    :class="[
      compact ? 'gap-1.5 rounded-lg border-2 bg-white p-2' : 'gap-2 rounded-lg border-2 bg-white p-3',
      selected ? 'border-blue-500 shadow-sm' : 'border-transparent',
    ]"
    @click="emit('select', item.id)"
  >
    <div
      class="flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100 font-semibold text-slate-600"
      :class="compact ? 'h-12 w-12 text-lg' : 'h-16 w-16 text-xl'"
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
    <!-- 名称完整展示：允许换行，不截断 -->
    <div
      class="w-full break-words text-slate-700 [overflow-wrap:anywhere]"
      :class="compact ? 'text-xs leading-snug' : 'text-sm leading-snug'"
    >
      {{ item.name || '未命名' }}
    </div>
  </button>
</template>
