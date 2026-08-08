<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useJumpStore } from './composables/useJumpStore'
import { useIsMobile } from './composables/useIsMobile'
import TopBar from './components/TopBar.vue'
import JumpGrid from './components/JumpGrid.vue'
import InspectorPanel from './components/InspectorPanel.vue'
import IframePreview from './components/IframePreview.vue'

const LS_WIDTH = 'jumpl.inspectorWidth'
const DEFAULT_WIDTH = 320
const MIN_WIDTH = 280
const MAX_RATIO = 0.7

const store = useJumpStore()
const { isMobile } = useIsMobile()

const inspectorWidth = ref(DEFAULT_WIDTH)
const dragging = ref(false)

const showInspectorOnMobile = computed(
  () => isMobile.value && Boolean(store.selectedId.value),
)

function clampWidth(w: number): number {
  const max = Math.floor(window.innerWidth * MAX_RATIO)
  return Math.min(max, Math.max(MIN_WIDTH, Math.round(w)))
}

function onResizeStart(e: MouseEvent | TouchEvent) {
  e.preventDefault()
  dragging.value = true
  const startX = 'touches' in e ? e.touches[0]!.clientX : e.clientX
  const startW = inspectorWidth.value

  function onMove(ev: MouseEvent | TouchEvent) {
    const x = 'touches' in ev ? ev.touches[0]!.clientX : ev.clientX
    // 手柄在面板左侧：向左拖 = 变宽
    inspectorWidth.value = clampWidth(startW + (startX - x))
  }

  function onEnd() {
    dragging.value = false
    try {
      localStorage.setItem(LS_WIDTH, String(inspectorWidth.value))
    } catch {
      /* ignore */
    }
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onEnd)
    window.removeEventListener('touchmove', onMove)
    window.removeEventListener('touchend', onEnd)
  }

  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onEnd)
  window.addEventListener('touchmove', onMove, { passive: false })
  window.addEventListener('touchend', onEnd)
}

function onWinResize() {
  inspectorWidth.value = clampWidth(inspectorWidth.value)
}

function backToList() {
  store.clearSelection()
}

onMounted(() => {
  try {
    const saved = Number(localStorage.getItem(LS_WIDTH))
    if (Number.isFinite(saved) && saved > 0) {
      inspectorWidth.value = clampWidth(saved)
    }
  } catch {
    /* ignore */
  }
  window.addEventListener('resize', onWinResize)
  void store.loadGlobalConfig({ confirmDirty: false })
})

onUnmounted(() => {
  window.removeEventListener('resize', onWinResize)
})

watch(isMobile, () => {
  /* layout switch only */
})
</script>

<template>
  <div class="flex h-dvh flex-col bg-slate-100 text-slate-800">
    <TopBar :store="store" :is-mobile="isMobile" />
    <div class="flex min-h-0 flex-1" :class="dragging ? 'select-none' : ''">
      <template v-if="store.isIframePreview.value">
        <IframePreview :store="store" :is-mobile="isMobile" />
      </template>
      <template v-else-if="isMobile">
        <InspectorPanel
          v-if="showInspectorOnMobile"
          :store="store"
          :is-mobile="true"
          @back="backToList"
        />
        <JumpGrid v-else :store="store" :is-mobile="true" />
      </template>
      <template v-else>
        <JumpGrid :store="store" :is-mobile="false" />
        <!-- 拖拽手柄：左右拉动调整属性面板宽度，Grid 随 flex 自适应 -->
        <div
          class="group relative z-10 w-1 shrink-0 cursor-col-resize bg-slate-200 transition hover:bg-blue-400"
          :class="dragging ? 'bg-blue-500' : ''"
          title="拖动调整属性面板宽度"
          @mousedown="onResizeStart"
          @touchstart.prevent="onResizeStart"
        >
          <div
            class="absolute inset-y-0 -left-1 -right-1"
            aria-hidden="true"
          />
        </div>
        <InspectorPanel
          :store="store"
          :is-mobile="false"
          :width="inspectorWidth"
        />
      </template>
    </div>
  </div>
</template>
