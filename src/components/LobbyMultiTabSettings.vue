<script setup lang="ts">
import { computed } from 'vue'
import { MAX_MULTI_TAB_COUNT, MIN_MULTI_TAB_COUNT, clampMultiTabCount } from '../utils/lobby'

const props = defineProps<{
  count: number
}>()

const emit = defineEmits<{
  'update:count': [val: number]
}>()

const presets = [2, 3, 4, 6, 9]

const gridLayoutHint = computed(() => {
  const n = clampMultiTabCount(props.count)
  if (n === 2) return '1行 × 2列（左右对半分屏）'
  if (n === 3) return '1行 × 3列（左中右三等分）'
  if (n === 4) return '2行 × 2列（田字格四等分）'
  const cols = Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  return `${rows}行 × ${cols}列（Chrome/Edge 均匀网格）`
})

function onCountChange(val: number | undefined | null) {
  if (typeof val === 'number' && Number.isFinite(val)) {
    emit('update:count', clampMultiTabCount(val))
  }
}
</script>

<template>
  <div class="space-y-2 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
    <div class="flex items-center justify-between">
      <label class="text-xs font-medium text-slate-700">
        标签数量（{{ MIN_MULTI_TAB_COUNT }} ~ {{ MAX_MULTI_TAB_COUNT }}）
      </label>
      <span class="text-[11px] text-amber-700">{{ gridLayoutHint }}</span>
    </div>
    <div class="flex items-center gap-2">
      <el-input-number
        :model-value="count"
        :min="MIN_MULTI_TAB_COUNT"
        :max="MAX_MULTI_TAB_COUNT"
        :step="1"
        size="small"
        class="!w-28"
        @update:model-value="onCountChange"
      />
      <div class="flex flex-wrap gap-1">
        <button
          v-for="n in presets"
          :key="n"
          type="button"
          class="rounded border px-2 py-0.5 text-xs transition"
          :class="
            count === n
              ? 'border-amber-500 bg-amber-500 font-medium text-white'
              : 'border-slate-300 bg-white text-slate-600 hover:border-amber-400'
          "
          @click="onCountChange(n)"
        >
          {{ n }}开
        </button>
      </div>
    </div>
    <p class="text-[11px] leading-snug text-slate-500">
      Chrome / Edge 打开时将自动创建 {{ count }} 个不重复账号并按网格均匀排列（若浏览器拦截多弹窗，将自动以同窗多宫格平铺展开）。
    </p>
  </div>
</template>
