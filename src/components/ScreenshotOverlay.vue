<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  Camera,
  Check,
  Close,
  Download,
  FullScreen,
  Message,
  Setting,
} from '@element-plus/icons-vue'
import { sendScreenshotEmail } from '../utils/api'

const props = defineProps<{
  pageUrl: string
  targetIframe?: HTMLIFrameElement | null
}>()

const LS_EMAIL_KEY = 'jumpl.screenshotEmail'
const DEFAULT_EMAIL = 'gcdxdy666@gmail.com'
const MIN_BOX_SIZE = 60

type ResizeDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

const active = ref(false)
const capturing = ref(false)
const sending = ref(false)
const capturedDataUrl = ref<string>('')
const naturalSize = reactive({ width: 0, height: 0 })

const vw = ref(window.innerWidth)
const vh = ref(window.innerHeight)

/** 截图框范围（视口像素坐标） */
const cropRect = reactive({
  x: 80,
  y: 60,
  w: 600,
  h: 400,
})

const email = ref(DEFAULT_EMAIL)
const mailSubject = ref('')
const mailContent = ref('')
const editingEmail = ref(false)
const emailInputRef = ref<HTMLInputElement | null>(null)

function loadSavedEmail() {
  try {
    const saved = localStorage.getItem(LS_EMAIL_KEY)?.trim() ?? ''
    email.value = saved || DEFAULT_EMAIL
    editingEmail.value = false
  } catch {
    email.value = DEFAULT_EMAIL
    editingEmail.value = false
  }
}

function isValidEmail(val: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())
}

function saveEmailSetting(showToast = true): boolean {
  const trimmed = email.value.trim() || DEFAULT_EMAIL
  if (!isValidEmail(trimmed)) {
    if (showToast) ElMessage.warning('请输入有效的邮箱地址（如 name@example.com）')
    editingEmail.value = true
    return false
  }
  email.value = trimmed
  try {
    localStorage.setItem(LS_EMAIL_KEY, trimmed)
  } catch {
    /* ignore */
  }
  editingEmail.value = false
  if (showToast) ElMessage.success(`收件邮箱已设置为 ${trimmed}`)
  return true
}

function toggleEmailEditor() {
  editingEmail.value = !editingEmail.value
  if (editingEmail.value) {
    void nextTick(() => {
      emailInputRef.value?.focus()
      emailInputRef.value?.select()
    })
  }
}

function resetDefaultCropRect() {
  vw.value = window.innerWidth
  vh.value = window.innerHeight
  const marginX = Math.max(24, Math.round(vw.value * 0.06))
  const marginY = Math.max(24, Math.round(vh.value * 0.06))
  cropRect.x = marginX
  cropRect.y = marginY
  cropRect.w = Math.max(MIN_BOX_SIZE, vw.value - marginX * 2)
  cropRect.h = Math.max(MIN_BOX_SIZE, vh.value - marginY * 2 - 44)
}

function selectFullScreen() {
  vw.value = window.innerWidth
  vh.value = window.innerHeight
  cropRect.x = 0
  cropRect.y = 0
  cropRect.w = vw.value
  cropRect.h = vh.value
}

function clampCropRect() {
  const maxW = vw.value
  const maxH = vh.value
  cropRect.w = Math.min(maxW, Math.max(MIN_BOX_SIZE, Math.round(cropRect.w)))
  cropRect.h = Math.min(maxH, Math.max(MIN_BOX_SIZE, Math.round(cropRect.h)))
  cropRect.x = Math.min(maxW - cropRect.w, Math.max(0, Math.round(cropRect.x)))
  cropRect.y = Math.min(maxH - cropRect.h, Math.max(0, Math.round(cropRect.y)))
}

/**
 * 兜底画布渲染：当浏览器不支持 getDisplayMedia（如非安全 HTTP 上下文）时，
 * 尝试抓取同源 iframe Canvas 或生成带当前页面信息的画布，保证截图框与邮件流程可用。
 */
function buildFallbackCanvas(): { dataUrl: string; width: number; height: number } {
  const width = Math.max(320, window.innerWidth)
  const height = Math.max(240, window.innerHeight)
  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * dpr)
  canvas.height = Math.round(height * dpr)
  const ctx = canvas.getContext('2d')!
  ctx.scale(dpr, dpr)

  ctx.fillStyle = '#0f172a'
  ctx.fillRect(0, 0, width, height)

  let drewIframeCanvas = false
  if (props.targetIframe) {
    try {
      const doc = props.targetIframe.contentDocument
      const srcCanvas = (doc?.getElementById('GameCanvas') ??
        doc?.querySelector('canvas')) as HTMLCanvasElement | null
      if (srcCanvas && srcCanvas.width > 0 && srcCanvas.height > 0) {
        ctx.drawImage(srcCanvas, 0, 0, width, height)
        drewIframeCanvas = true
      }
    } catch {
      /* 跨域无法直接读取 canvas */
    }
  }

  if (!drewIframeCanvas) {
    ctx.strokeStyle = '#334155'
    ctx.lineWidth = 1
    for (let x = 0; x < width; x += 40) {
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, height)
      ctx.stroke()
    }
    for (let y = 0; y < height; y += 40) {
      ctx.beginPath()
      ctx.moveTo(0, y)
      ctx.lineTo(width, y)
      ctx.stroke()
    }
    ctx.fillStyle = '#e2e8f0'
    ctx.font = 'bold 18px sans-serif'
    ctx.fillText('页面快照预览（当前环境不支持屏幕共享 API，已启用兜底画布）', 32, 64)
    ctx.fillStyle = '#94a3b8'
    ctx.font = '14px monospace'
    ctx.fillText(`URL: ${props.pageUrl || window.location.href}`, 32, 98)
    ctx.fillText(`Time: ${new Date().toLocaleString()}`, 32, 124)
  }

  return {
    dataUrl: canvas.toDataURL('image/png'),
    width: canvas.width,
    height: canvas.height,
  }
}

/**
 * 调用浏览器原生 getDisplayMedia 截取全屏（包含 F12 控制台与跨域游戏画面）
 */
async function triggerScreenshot() {
  if (capturing.value) return
  capturing.value = true
  try {
    if (navigator.mediaDevices && typeof navigator.mediaDevices.getDisplayMedia === 'function') {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'monitor',
        },
        audio: false,
      })

      try {
        const video = document.createElement('video')
        video.srcObject = stream
        video.muted = true
        video.playsInline = true

        await new Promise<void>((resolve, reject) => {
          video.onloadedmetadata = () => {
            video.play().then(() => resolve()).catch(reject)
          }
          video.onerror = () => reject(new Error('视频流加载失败'))
        })

        // 等待一帧及共享弹窗淡出，确保截到干净的全屏+控制台画面
        await new Promise((r) => window.setTimeout(r, 180))

        const width = video.videoWidth || window.innerWidth
        const height = video.videoHeight || window.innerHeight
        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('无法创建绘图上下文')
        ctx.drawImage(video, 0, 0, width, height)

        capturedDataUrl.value = canvas.toDataURL('image/png')
        naturalSize.width = width
        naturalSize.height = height
      } finally {
        stream.getTracks().forEach((track) => track.stop())
      }
    } else {
      const fallback = buildFallbackCanvas()
      capturedDataUrl.value = fallback.dataUrl
      naturalSize.width = fallback.width
      naturalSize.height = fallback.height
      ElMessage.info('当前环境不支持原生屏幕捕获，已使用页面画布快照')
    }

    loadSavedEmail()
    resetDefaultCropRect()
    active.value = true
  } catch (err) {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      // 用户取消了屏幕共享选择器，静默返回
      return
    }
    console.warn('[triggerScreenshot] getDisplayMedia failed, using fallback', err)
    const fallback = buildFallbackCanvas()
    capturedDataUrl.value = fallback.dataUrl
    naturalSize.width = fallback.width
    naturalSize.height = fallback.height
    loadSavedEmail()
    resetDefaultCropRect()
    active.value = true
  } finally {
    capturing.value = false
  }
}

function closeOverlay() {
  active.value = false
  capturedDataUrl.value = ''
}

/** 拖拽移动选区 / 8方向缩放选区 / 空白处重画选区 */
function startPointerAction(
  e: MouseEvent | TouchEvent,
  mode: 'move' | 'new' | ResizeDir,
) {
  e.stopPropagation()
  if ('touches' in e && e.cancelable) e.preventDefault()

  const pt = 'touches' in e ? e.touches[0]! : e
  const startX = pt.clientX
  const startY = pt.clientY
  const orig = { ...cropRect }

  if (mode === 'new') {
    orig.x = startX
    orig.y = startY
    orig.w = MIN_BOX_SIZE
    orig.h = MIN_BOX_SIZE
    cropRect.x = startX
    cropRect.y = startY
    cropRect.w = MIN_BOX_SIZE
    cropRect.h = MIN_BOX_SIZE
  }

  function onMove(ev: MouseEvent | TouchEvent) {
    const p = 'touches' in ev ? ev.touches[0]! : ev
    const dx = p.clientX - startX
    const dy = p.clientY - startY

    if (mode === 'move') {
      cropRect.x = Math.min(vw.value - orig.w, Math.max(0, orig.x + dx))
      cropRect.y = Math.min(vh.value - orig.h, Math.max(0, orig.y + dy))
      return
    }

    if (mode === 'new') {
      const x1 = Math.max(0, Math.min(startX, p.clientX))
      const y1 = Math.max(0, Math.min(startY, p.clientY))
      const x2 = Math.min(vw.value, Math.max(startX, p.clientX))
      const y2 = Math.min(vh.value, Math.max(startY, p.clientY))
      cropRect.x = x1
      cropRect.y = y1
      cropRect.w = Math.max(MIN_BOX_SIZE, x2 - x1)
      cropRect.h = Math.max(MIN_BOX_SIZE, y2 - y1)
      return
    }

    let nextX = orig.x
    let nextY = orig.y
    let nextW = orig.w
    let nextH = orig.h

    if (mode.includes('e')) {
      nextW = Math.min(vw.value - orig.x, Math.max(MIN_BOX_SIZE, orig.w + dx))
    }
    if (mode.includes('s')) {
      nextH = Math.min(vh.value - orig.y, Math.max(MIN_BOX_SIZE, orig.h + dy))
    }
    if (mode.includes('w')) {
      const maxLeftShift = orig.w - MIN_BOX_SIZE
      const shift = Math.max(-orig.x, Math.min(maxLeftShift, dx))
      nextX = orig.x + shift
      nextW = orig.w - shift
    }
    if (mode.includes('n')) {
      const maxTopShift = orig.h - MIN_BOX_SIZE
      const shift = Math.max(-orig.y, Math.min(maxTopShift, dy))
      nextY = orig.y + shift
      nextH = orig.h - shift
    }

    cropRect.x = Math.round(nextX)
    cropRect.y = Math.round(nextY)
    cropRect.w = Math.round(nextW)
    cropRect.h = Math.round(nextH)
  }

  function onEnd() {
    clampCropRect()
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

/** 计算裁剪后的真实像素尺寸显示 */
const pixelDimensionLabel = computed(() => {
  const scaleX = naturalSize.width > 0 && vw.value > 0 ? naturalSize.width / vw.value : 1
  const scaleY = naturalSize.height > 0 && vh.value > 0 ? naturalSize.height / vh.value : 1
  const pw = Math.round(cropRect.w * scaleX)
  const ph = Math.round(cropRect.h * scaleY)
  return `${pw} × ${ph} px`
})

/**
 * 边缘操作栏定位：紧贴截图框边缘（优先贴合底边外侧；若触底则贴顶边外侧；若全屏则内贴底边）
 */
const edgeToolbarStyle = computed(() => {
  const toolbarH = 44
  const gap = 8
  const bottomSpace = vh.value - (cropRect.y + cropRect.h)
  const topSpace = cropRect.y

  let top: number
  if (bottomSpace >= toolbarH + gap) {
    top = cropRect.y + cropRect.h + gap
  } else if (topSpace >= toolbarH + gap) {
    top = cropRect.y - toolbarH - gap
  } else {
    top = Math.max(8, cropRect.y + cropRect.h - toolbarH - gap)
  }

  const rightEdge = Math.min(vw.value - 8, Math.max(8, cropRect.x + cropRect.w))
  return {
    top: `${Math.round(top)}px`,
    right: `${Math.max(8, Math.round(vw.value - rightEdge))}px`,
  }
})

/** 按选区裁剪出最终高清 PNG DataURL */
async function buildCroppedDataUrl(): Promise<string> {
  if (!capturedDataUrl.value) throw new Error('无可用截图')
  const img = new Image()
  img.src = capturedDataUrl.value
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('截图图像加载失败'))
  })

  const scaleX = img.naturalWidth / Math.max(1, vw.value)
  const scaleY = img.naturalHeight / Math.max(1, vh.value)
  const sx = Math.max(0, Math.round(cropRect.x * scaleX))
  const sy = Math.max(0, Math.round(cropRect.y * scaleY))
  const sw = Math.min(img.naturalWidth - sx, Math.max(1, Math.round(cropRect.w * scaleX)))
  const sh = Math.min(img.naturalHeight - sy, Math.max(1, Math.round(cropRect.h * scaleY)))

  const canvas = document.createElement('canvas')
  canvas.width = sw
  canvas.height = sh
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建裁剪画布')
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh)
  return canvas.toDataURL('image/png')
}

async function handleDownload() {
  try {
    const cropped = await buildCroppedDataUrl()
    const a = document.createElement('a')
    a.href = cropped
    a.download = `screenshot-${Date.now()}.png`
    a.click()
    ElMessage.success('已下载裁剪截图')
  } catch (err) {
    ElMessage.error(err instanceof Error ? err.message : '下载截图失败')
  }
}

async function handleSendEmail() {
  if (!saveEmailSetting(true)) return
  sending.value = true
  try {
    const imageDataUrl = await buildCroppedDataUrl()
    const res = await sendScreenshotEmail({
      to: email.value,
      imageDataUrl,
      pageUrl: props.pageUrl || window.location.href,
      subject: mailSubject.value.trim(),
      content: mailContent.value.trim(),
    })
    ElMessage.success(res.message || `截图已发送至 ${email.value}`)
    closeOverlay()
  } catch (err) {
    console.error('[handleSendEmail]', err)
    ElMessage.error(err instanceof Error ? err.message : '发送邮件失败')
  } finally {
    sending.value = false
  }
}

function onWinResize() {
  vw.value = window.innerWidth
  vh.value = window.innerHeight
  if (active.value) clampCropRect()
}

function onKeyDown(e: KeyboardEvent) {
  if (e.key === 'Escape' && active.value) {
    closeOverlay()
  }
}

onMounted(() => {
  window.addEventListener('resize', onWinResize)
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('resize', onWinResize)
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<template>
  <!-- 左上角截图触发按钮（嵌入在左上角控制条中） -->
  <el-button
    :icon="Camera"
    :loading="capturing"
    size="small"
    circle
    class="!border-white/20 !bg-black/50 !text-white hover:!bg-black/70"
    title="截图（支持全屏及控制台）并发送邮件"
    @click="triggerScreenshot"
  />

  <!-- 全屏截图框选与边缘邮箱发送层 -->
  <Teleport to="body">
    <div
      v-if="active"
      class="fixed inset-0 z-[5000] select-none overflow-hidden bg-black"
      @mousedown="(e) => startPointerAction(e, 'new')"
      @touchstart="(e) => startPointerAction(e, 'new')"
    >
      <!-- 捕获的全屏底图 -->
      <img
        :src="capturedDataUrl"
        alt="captured-screen"
        class="pointer-events-none block h-full w-full object-fill"
      />

      <!-- 选区四周半透明遮罩（保证选区内部清晰明亮） -->
      <div
        class="pointer-events-none absolute left-0 right-0 top-0 bg-black/55"
        :style="{ height: `${cropRect.y}px` }"
      />
      <div
        class="pointer-events-none absolute bottom-0 left-0 right-0 bg-black/55"
        :style="{ top: `${cropRect.y + cropRect.h}px` }"
      />
      <div
        class="pointer-events-none absolute left-0 bg-black/55"
        :style="{
          top: `${cropRect.y}px`,
          width: `${cropRect.x}px`,
          height: `${cropRect.h}px`,
        }"
      />
      <div
        class="pointer-events-none absolute right-0 bg-black/55"
        :style="{
          top: `${cropRect.y}px`,
          left: `${cropRect.x + cropRect.w}px`,
          height: `${cropRect.h}px`,
        }"
      />

      <!-- 可拖拽移动与缩放的截图框 -->
      <div
        class="absolute cursor-move border-2 border-blue-400 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]"
        :style="{
          left: `${cropRect.x}px`,
          top: `${cropRect.y}px`,
          width: `${cropRect.w}px`,
          height: `${cropRect.h}px`,
        }"
        @mousedown="(e) => startPointerAction(e, 'move')"
        @touchstart="(e) => startPointerAction(e, 'move')"
      >
        <!-- 左上角像素尺寸与提示标签 -->
        <div
          class="pointer-events-none absolute left-1.5 top-1.5 rounded bg-black/70 px-2 py-0.5 text-[11px] leading-4 text-white"
        >
          {{ pixelDimensionLabel }} · 拖动边框调整截图范围
        </div>

        <!-- 八方向缩放控制点 -->
        <span
          class=" absolute -left-1.5 -top-1.5 h-3 w-3 cursor-nwse-resize border border-white bg-blue-500"
          @mousedown="(e) => startPointerAction(e, 'nw')"
          @touchstart="(e) => startPointerAction(e, 'nw')"
        />
        <span
          class="absolute -top-1.5 left-1/2 h-3 w-3 -translate-x-1/2 cursor-ns-resize border border-white bg-blue-500"
          @mousedown="(e) => startPointerAction(e, 'n')"
          @touchstart="(e) => startPointerAction(e, 'n')"
        />
        <span
          class="absolute -right-1.5 -top-1.5 h-3 w-3 cursor-nesw-resize border border-white bg-blue-500"
          @mousedown="(e) => startPointerAction(e, 'ne')"
          @touchstart="(e) => startPointerAction(e, 'ne')"
        />
        <span
          class="absolute -right-1.5 top-1/2 h-3 w-3 -translate-y-1/2 cursor-ew-resize border border-white bg-blue-500"
          @mousedown="(e) => startPointerAction(e, 'e')"
          @touchstart="(e) => startPointerAction(e, 'e')"
        />
        <span
          class="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize border border-white bg-blue-500"
          @mousedown="(e) => startPointerAction(e, 'se')"
          @touchstart="(e) => startPointerAction(e, 'se')"
        />
        <span
          class="absolute -bottom-1.5 left-1/2 h-3 w-3 -translate-x-1/2 cursor-ns-resize border border-white bg-blue-500"
          @mousedown="(e) => startPointerAction(e, 's')"
          @touchstart="(e) => startPointerAction(e, 's')"
        />
        <span
          class="absolute -bottom-1.5 -left-1.5 h-3 w-3 cursor-nesw-resize border border-white bg-blue-500"
          @mousedown="(e) => startPointerAction(e, 'sw')"
          @touchstart="(e) => startPointerAction(e, 'sw')"
        />
        <span
          class="absolute -left-1.5 top-1/2 h-3 w-3 -translate-y-1/2 cursor-ew-resize border border-white bg-blue-500"
          @mousedown="(e) => startPointerAction(e, 'w')"
          @touchstart="(e) => startPointerAction(e, 'w')"
        />
      </div>

      <!-- 截图框边缘工具栏（邮箱设置与发送均在截图框边缘） -->
      <div
        class="absolute z-10 flex max-w-[calc(100vw-16px)] flex-wrap items-center gap-1.5 rounded-lg border border-white/20 bg-slate-900/95 px-2.5 py-1.5 text-xs text-white shadow-xl backdrop-blur"
        :style="edgeToolbarStyle"
        @mousedown.stop
        @touchstart.stop
      >
        <!-- 邮箱设置区（位于截图框边缘） -->
        <template v-if="editingEmail">
          <input
            ref="emailInputRef"
            v-model="email"
            type="email"
            placeholder="设置收件邮箱 (如 user@example.com)"
            class="h-7 w-52 rounded border border-slate-600 bg-slate-800 px-2 text-xs text-white placeholder-slate-400 focus:border-blue-400 focus:outline-none"
            @keydown.enter.prevent="saveEmailSetting(true)"
          />
          <el-button
            size="small"
            type="primary"
            plain
            :icon="Check"
            title="保存收件邮箱"
            @click="saveEmailSetting(true)"
          >
            确定邮箱
          </el-button>
        </template>
        <template v-else>
          <button
            type="button"
            class="flex h-7 items-center gap-1 rounded border border-slate-700 bg-slate-800 px-2 text-xs text-slate-200 transition hover:border-blue-400 hover:text-white"
            title="点击修改收件邮箱"
            @click="toggleEmailEditor"
          >
            <el-icon><Setting /></el-icon>
            <span class="max-w-[180px] truncate">{{ email || '设置邮箱' }}</span>
          </button>
        </template>

        <!-- 邮件标题与内容输入框（位于发送邮件旁，均允许为空） -->
        <input
          v-model="mailSubject"
          type="text"
          placeholder="邮件标题（可空）"
          class="h-7 w-32 rounded border border-slate-700 bg-slate-800 px-2 text-xs text-white placeholder-slate-400 focus:border-blue-400 focus:outline-none"
          @keydown.enter.prevent="handleSendEmail"
        />
        <input
          v-model="mailContent"
          type="text"
          placeholder="邮件内容（可空）"
          class="h-7 w-44 rounded border border-slate-700 bg-slate-800 px-2 text-xs text-white placeholder-slate-400 focus:border-blue-400 focus:outline-none"
          @keydown.enter.prevent="handleSendEmail"
        />

        <!-- 发送到邮箱按钮（位于截图框边缘） -->
        <el-button
          size="small"
          type="primary"
          :icon="Message"
          :loading="sending"
          title="将选区截图发送到指定邮箱"
          @click="handleSendEmail"
        >
          发送邮件
        </el-button>

        <div class="mx-0.5 h-4 w-px bg-slate-700" />

        <el-button
          size="small"
          :icon="FullScreen"
          class="!border-slate-700 !bg-slate-800 !text-slate-200 hover:!text-white"
          title="框选全屏范围"
          @click="selectFullScreen"
        >
          全屏
        </el-button>

        <el-button
          size="small"
          :icon="Download"
          class="!border-slate-700 !bg-slate-800 !text-slate-200 hover:!text-white"
          title="下载选区截图到本地"
          @click="handleDownload"
        />

        <el-button
          size="small"
          :icon="Close"
          class="!border-slate-700 !bg-slate-800 !text-slate-200 hover:!text-white"
          title="关闭截图 (Esc)"
          @click="closeOverlay"
        />
      </div>
    </div>
  </Teleport>
</template>

