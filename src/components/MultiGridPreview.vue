<script setup lang="ts">
import { computed, ref } from 'vue'
import { Back, FullScreen, RefreshRight, TopRight } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import type { JumpStore } from '../composables/useJumpStore'
import { buildPreviewTabUrl } from '../composables/useJumpStore'
import { computeChromeGridRects } from '../utils/lobby'

const props = defineProps<{
  store: JumpStore
}>()

const panes = computed(() => props.store.multiGridPanes.value)
const maximizedIndex = ref<number | null>(null)
const reloadSeeds = ref<Record<number, number>>({})

const gridStyle = computed(() => {
  const n = panes.value.length
  if (maximizedIndex.value !== null || n <= 1) {
    return {
      gridTemplateColumns: 'repeat(1, minmax(0, 1fr))',
      gridTemplateRows: 'repeat(1, minmax(0, 1fr))',
    }
  }
  const cols = n === 2 ? 2 : n === 3 ? 3 : Math.ceil(Math.sqrt(n))
  const rows = Math.ceil(n / cols)
  return {
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
  }
})

function toggleMaximize(index: number) {
  maximizedIndex.value = maximizedIndex.value === index ? null : index
}

function reloadPane(index: number) {
  reloadSeeds.value = {
    ...reloadSeeds.value,
    [index]: (reloadSeeds.value[index] ?? 0) + 1,
  }
}

function openSingleWindow(url: string) {
  const wrapper = buildPreviewTabUrl(url)
  const w = window.open(wrapper, '_blank')
  if (!w) {
    ElMessage.warning('弹窗被拦截，请在地址栏右侧允许本站弹出窗口')
  }
}

/** 尝试将当前全部画面拆分为 Chrome / Edge 独立系统窗口均匀平铺 */
function popOutAllWindows() {
  const list = panes.value
  const rects = computeChromeGridRects(list.length)
  let opened = 0
  list.forEach((pane, idx) => {
    const rect = rects[idx]!
    const features = [
      'popup=yes',
      `left=${rect.left}`,
      `top=${rect.top}`,
      `width=${rect.width}`,
      `height=${rect.height}`,
      'resizable=yes',
      'scrollbars=yes',
    ].join(',')
    const wrapper = buildPreviewTabUrl(pane.url, rect)
    const w = window.open(wrapper, `jumpl_lobby_slot_${idx}`, features)
    if (w) {
      opened += 1
      try {
        w.resizeTo(rect.width, rect.height)
        w.moveTo(rect.left, rect.top)
      } catch {
        /* ignore */
      }
    }
  })
  if (opened < list.length) {
    ElMessage.warning(
      `已弹出 ${opened}/${list.length} 个独立窗口。请在 Chrome/Edge 地址栏右侧点击「已拦截弹出式窗口」勾选「始终允许」后再点击拆分`,
    )
  } else {
    ElMessage.success(`已将全部 ${opened} 个账号拆分为独立均匀平铺窗口`)
  }
}
</script>

<template>
  <section class="fixed inset-0 z-[3000] flex flex-col overflow-hidden bg-slate-950 text-white">
    <!-- 顶部紧凑控制条 -->
    <header class="flex h-9 shrink-0 items-center justify-between border-b border-slate-800 bg-slate-900 px-3 text-xs">
      <div class="flex items-center gap-2">
        <el-button
          :icon="Back"
          size="small"
          class="!border-slate-700 !bg-slate-800 !text-white hover:!bg-slate-700"
          @click="store.closeMultiGrid()"
        >
          返回
        </el-button>
        <span class="font-medium text-sky-400">多标签均匀平铺（{{ panes.length }} 个独立账号）</span>
      </div>
      <div class="flex items-center gap-2">
        <el-button
          size="small"
          :icon="TopRight"
          class="!border-slate-700 !bg-slate-800 !text-slate-200 hover:!bg-slate-700"
          title="若浏览器已允许弹出多个窗口，可一键拆分为多个独立系统窗口"
          @click="popOutAllWindows"
        >
          拆分为独立多窗口
        </el-button>
      </div>
    </header>

    <!-- 按数量均匀排列的多账号游戏网格 -->
    <div class="grid min-h-0 flex-1 gap-1 bg-slate-900 p-1" :style="gridStyle">
      <div
        v-for="(pane, idx) in panes"
        v-show="maximizedIndex === null || maximizedIndex === idx"
        :key="`${pane.uuid}-${reloadSeeds[idx] ?? 0}`"
        class="relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded border border-slate-700 bg-black"
      >
        <div class="flex h-7 shrink-0 items-center justify-between bg-slate-900/95 px-2 text-[11px] text-slate-300">
          <div class="flex min-w-0 items-center gap-1.5 truncate">
            <span class="rounded bg-sky-600/80 px-1.5 py-0.5 text-[10px] font-semibold text-white">
              #{{ idx + 1 }}
            </span>
            <span class="truncate font-medium text-white">{{ pane.nickname }}</span>
            <span class="truncate text-slate-400">({{ pane.uuid }})</span>
          </div>
          <div class="flex shrink-0 items-center gap-1">
            <button
              type="button"
              class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              title="刷新该账号画面"
              @click="reloadPane(idx)"
            >
              <el-icon><RefreshRight /></el-icon>
            </button>
            <button
              type="button"
              class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              :title="maximizedIndex === idx ? '还原网格' : '放大此窗口'"
              @click="toggleMaximize(idx)"
            >
              <el-icon><FullScreen /></el-icon>
            </button>
            <button
              type="button"
              class="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
              title="在独立标签页中打开"
              @click="openSingleWindow(pane.url)"
            >
              <el-icon><TopRight /></el-icon>
            </button>
          </div>
        </div>
        <iframe
          :src="pane.url"
          :title="`lobby-account-${idx + 1}`"
          class="min-h-0 flex-1 border-0 bg-black"
          allow="autoplay; fullscreen; screen-orientation; clipboard-read; clipboard-write; gyroscope; accelerometer; gamepad; microphone; camera; web-share"
          allowfullscreen
        />
      </div>
    </div>
  </section>
</template>
