<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Back, RefreshRight } from '@element-plus/icons-vue'
import type { JumpStore } from '../composables/useJumpStore'

const props = defineProps<{
  store: JumpStore
  isMobile?: boolean
}>()

type GameOrientation = 'portrait' | 'landscape'

/** 手动指定的方向按 origin+pathname 记忆在本地 */
const LS_ORIENT = 'jumpl.iframeOrientation'
/** 同源检测轮询：间隔 / 最长时长 */
const POLL_INTERVAL = 500
const POLL_TIMEOUT = 30_000

const iframeRef = ref<HTMLIFrameElement | null>(null)
const vw = ref(0)
const vh = ref(0)
/** 检测到的游戏分辨率（GameCanvas / 设计分辨率 / postMessage） */
const gameSize = ref<{ width: number; height: number } | null>(null)
const detectSource = ref<string>('')
/** 手动覆盖的方向；null 表示自动 */
const manualOrientation = ref<GameOrientation | null>(null)

let pollTimer: number | undefined
let pollStart = 0

const src = computed(() => props.store.iframeSrc.value)

const gameOrientation = computed<GameOrientation | null>(() => {
  if (manualOrientation.value) return manualOrientation.value
  const s = gameSize.value
  if (!s || s.width === s.height) return null
  return s.width > s.height ? 'landscape' : 'portrait'
})

const viewportLandscape = computed(() => vw.value > vh.value)

/** 游戏方向与设备方向不一致时，旋转 90° 显示 */
const rotated = computed(() => {
  const o = gameOrientation.value
  if (!o) return false
  return (o === 'landscape') !== viewportLandscape.value
})

const stageStyle = computed(() => {
  if (!rotated.value) {
    return { width: `${vw.value}px`, height: `${vh.value}px`, transform: 'none' }
  }
  // 宽高互换后绕左上角顺时针旋转 90°，再平移回视口内
  return {
    width: `${vh.value}px`,
    height: `${vw.value}px`,
    transformOrigin: 'top left',
    transform: 'rotate(90deg) translateY(-100%)',
  }
})

const statusText = computed(() => {
  const s = gameSize.value
  const o = gameOrientation.value
  const parts: string[] = []
  if (s) parts.push(`${s.width}×${s.height}`)
  if (manualOrientation.value) parts.push(o === 'landscape' ? '手动横屏' : '手动竖屏')
  else if (o) parts.push(o === 'landscape' ? '自动横屏' : '自动竖屏')
  else parts.push('未识别分辨率')
  return parts.join(' · ')
})

function updateViewport() {
  const vv = window.visualViewport
  vw.value = Math.round(vv?.width ?? window.innerWidth)
  vh.value = Math.round(vv?.height ?? window.innerHeight)
}

function onViewportChange() {
  updateViewport()
  // iOS 旋转后尺寸有延迟，补一次
  window.setTimeout(updateViewport, 300)
}

function orientKey(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return u.origin + u.pathname
  } catch {
    return null
  }
}

function readSavedOrientation(url: string | null): GameOrientation | null {
  const key = orientKey(url)
  if (!key) return null
  try {
    const map = JSON.parse(localStorage.getItem(LS_ORIENT) || '{}') as Record<string, unknown>
    const v = map[key]
    return v === 'landscape' || v === 'portrait' ? v : null
  } catch {
    return null
  }
}

function saveOrientation(url: string | null, v: GameOrientation | null) {
  const key = orientKey(url)
  if (!key) return
  try {
    const map = JSON.parse(localStorage.getItem(LS_ORIENT) || '{}') as Record<string, unknown>
    if (v) map[key] = v
    else delete map[key]
    localStorage.setItem(LS_ORIENT, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

function setGameSize(w: unknown, h: unknown, source: string): boolean {
  const width = Number(w)
  const height = Number(h)
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return false
  const prev = gameSize.value
  if (!prev || prev.width !== width || prev.height !== height) {
    gameSize.value = { width: Math.round(width), height: Math.round(height) }
    detectSource.value = source
    console.info('[IframePreview] game size', gameSize.value, source)
  }
  return true
}

type CocosLike = {
  view?: {
    getDesignResolutionSize?: () => { width: number; height: number }
  }
}

/**
 * 同源时直接读取 iframe 内的 Cocos 设计分辨率 / #GameCanvas 尺寸。
 * 跨域会抛 SecurityError，返回 'cross' 让调用方停止轮询（改走 postMessage / 手动）。
 */
function probeSameOrigin(): 'ok' | 'pending' | 'cross' {
  const frame = iframeRef.value
  if (!frame) return 'pending'
  let win: (Window & { cc?: CocosLike }) | null
  let doc: Document | null
  try {
    win = frame.contentWindow as (Window & { cc?: CocosLike }) | null
    doc = frame.contentDocument
    // 访问 location.href 触发跨域检测
    void win?.location.href
  } catch {
    return 'cross'
  }
  if (!win || !doc) return 'cross'

  try {
    const design = win.cc?.view?.getDesignResolutionSize?.()
    if (design && setGameSize(design.width, design.height, 'cc.view 设计分辨率')) return 'ok'
  } catch {
    /* ignore */
  }

  const canvas = (doc.getElementById('GameCanvas') ?? doc.querySelector('canvas')) as
    | HTMLCanvasElement
    | null
  if (canvas && canvas.width > 0 && canvas.height > 0) {
    // canvas 已就绪但 cc 尚未初始化时先用画布尺寸，继续轮询以获得设计分辨率
    setGameSize(canvas.width, canvas.height, 'GameCanvas')
  }
  return 'pending'
}

function stopPolling() {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer)
    pollTimer = undefined
  }
}

function startPolling() {
  stopPolling()
  pollStart = Date.now()
  pollTimer = window.setInterval(() => {
    const r = probeSameOrigin()
    if (r !== 'pending' || Date.now() - pollStart > POLL_TIMEOUT) stopPolling()
  }, POLL_INTERVAL)
}

function requestSizeFromGame() {
  // 跨域游戏可监听此消息并回传 { type: 'gameSize', width, height }
  try {
    iframeRef.value?.contentWindow?.postMessage({ type: 'getGameSize' }, '*')
  } catch {
    /* ignore */
  }
}

function onIframeLoad() {
  if (probeSameOrigin() === 'pending') startPolling()
  requestSizeFromGame()
}

/**
 * 跨域游戏通过 postMessage 上报分辨率，支持：
 *  { type: 'gameSize' | 'resolution', width, height }
 *  { width, height } / { designWidth, designHeight }
 *  { orientation: 'landscape' | 'portrait' }
 */
function onMessage(e: MessageEvent) {
  const frame = iframeRef.value
  if (!frame || e.source !== frame.contentWindow) return
  let data: unknown = e.data
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data)
    } catch {
      return
    }
  }
  if (!data || typeof data !== 'object') return
  const d = data as Record<string, unknown>
  if (setGameSize(d.designWidth, d.designHeight, 'postMessage')) return
  if (setGameSize(d.width, d.height, 'postMessage')) return
  if (d.orientation === 'landscape') setGameSize(16, 9, 'postMessage orientation')
  else if (d.orientation === 'portrait') setGameSize(9, 16, 'postMessage orientation')
}

/** 手动切换：自动 → 横屏 → 竖屏 → 自动 */
function toggleOrientation() {
  const cur = manualOrientation.value
  const next: GameOrientation | null =
    cur === null ? (gameOrientation.value === 'landscape' ? 'portrait' : 'landscape')
    : cur === 'landscape' ? 'portrait'
    : null
  manualOrientation.value = next
  saveOrientation(src.value, next)
}

/** Android Chrome 等支持时尝试锁定屏幕方向（iOS Safari 不支持，靠 CSS 旋转兜底） */
function tryLockOrientation() {
  const o = gameOrientation.value
  const so = screen.orientation as ScreenOrientation & {
    lock?: (o: string) => Promise<void>
  }
  if (!o || !so?.lock) return
  so.lock(o).catch(() => {
    /* 未全屏或不支持时会失败，忽略 */
  })
}

function resetForSrc(url: string | null) {
  stopPolling()
  gameSize.value = null
  detectSource.value = ''
  manualOrientation.value = readSavedOrientation(url)
}

watch(src, (url) => {
  resetForSrc(url)
})

watch(gameOrientation, () => {
  tryLockOrientation()
})

// 尺寸变化后通知同源游戏重新适配
watch([vw, vh, rotated], async () => {
  await nextTick()
  try {
    iframeRef.value?.contentWindow?.dispatchEvent(new Event('resize'))
  } catch {
    /* 跨域时浏览器会自动派发 resize */
  }
})

onMounted(() => {
  updateViewport()
  resetForSrc(src.value)
  window.addEventListener('resize', onViewportChange)
  window.addEventListener('orientationchange', onViewportChange)
  window.visualViewport?.addEventListener('resize', onViewportChange)
  window.addEventListener('message', onMessage)
  document.documentElement.classList.add('game-playing')
})

onUnmounted(() => {
  stopPolling()
  window.removeEventListener('resize', onViewportChange)
  window.removeEventListener('orientationchange', onViewportChange)
  window.visualViewport?.removeEventListener('resize', onViewportChange)
  window.removeEventListener('message', onMessage)
  document.documentElement.classList.remove('game-playing')
  try {
    screen.orientation?.unlock?.()
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <!-- 固定铺满视口：iOS Safari 下 flex 内 iframe 高度不稳定，会导致游戏黑屏，这里使用显式像素尺寸 -->
  <section class="game-overlay fixed inset-0 z-[3000] overflow-hidden bg-black">
    <div class="absolute left-0 top-0" :style="stageStyle">
      <iframe
        v-if="src"
        ref="iframeRef"
        :key="src"
        :src="src"
        class="block h-full w-full border-0 bg-black"
        title="jump-preview"
        allow="autoplay; fullscreen; screen-orientation; clipboard-write; gyroscope; accelerometer"
        allowfullscreen
        @load="onIframeLoad"
      />
    </div>

    <!-- 悬浮控制条（不随舞台旋转，始终在设备左上角） -->
    <div
      class="absolute left-2 z-10 flex items-center gap-1.5"
      style="top: max(8px, env(safe-area-inset-top))"
    >
      <el-button
        :icon="Back"
        size="small"
        circle
        class="!border-white/20 !bg-black/50 !text-white"
        title="返回"
        @click="store.closeIframe()"
      />
      <el-button
        :icon="RefreshRight"
        size="small"
        circle
        class="!border-white/20 !bg-black/50 !text-white"
        title="切换横竖屏（自动 / 横屏 / 竖屏）"
        @click="toggleOrientation"
      />
      <span
        class="rounded bg-black/50 px-1.5 py-0.5 text-[10px] leading-4 text-white/80"
        :title="detectSource"
      >
        {{ statusText }}
      </span>
    </div>
  </section>
</template>

<style scoped>
.game-overlay {
  overscroll-behavior: none;
}
</style>

<style>
/* 游戏打开时禁止外层页面滚动/回弹 */
html.game-playing,
html.game-playing body {
  overflow: hidden;
  overscroll-behavior: none;
  height: 100%;
}
</style>
