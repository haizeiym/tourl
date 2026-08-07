<script setup lang="ts">
import {
  ArrowDown,
  DocumentAdd,
  Download,
  FolderOpened,
  Link,
  Plus,
  Refresh,
  Upload,
} from '@element-plus/icons-vue'
import { ref } from 'vue'
import type { JumpStore } from '../composables/useJumpStore'

const props = defineProps<{
  store: JumpStore
  isMobile: boolean
}>()

const fileInput = ref<HTMLInputElement | null>(null)

function onPickFile() {
  fileInput.value?.click()
}

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (file) await props.store.importConfig(file)
}

function onMoreCommand(cmd: string | number | object) {
  const key = String(cmd)
  if (key === 'newConfig') void props.store.newConfig()
  if (key === 'import') onPickFile()
  if (key === 'export') props.store.exportConfig()
  if (key === 'fromUrl') void props.store.addJumpFromUrl()
}
</script>

<template>
  <header
    class="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 md:h-14 md:px-4"
  >
    <div
      class="shrink-0 text-sm font-semibold tracking-tight text-slate-800 md:mr-2 md:text-base"
    >
      URL 跳转
    </div>

    <!-- 桌面：完整按钮条 -->
    <template v-if="!isMobile">
      <el-button
        type="success"
        :icon="Upload"
        :loading="store.saving.value"
        @click="store.saveToGlobal()"
      >
        保存到全局
      </el-button>
      <el-button
        :icon="Refresh"
        :loading="store.loading.value"
        @click="store.refreshGlobal()"
      >
        刷新全局
      </el-button>
      <el-button type="primary" :icon="Plus" @click="store.addJump()">新建跳转</el-button>
      <el-button :icon="Link" @click="store.addJumpFromUrl()">根据 URL 添加</el-button>
      <el-button :icon="DocumentAdd" @click="store.newConfig()">新建配置</el-button>
      <el-button :icon="FolderOpened" @click="onPickFile">导入配置</el-button>
      <el-button :icon="Download" @click="store.exportConfig()">导出配置</el-button>
    </template>

    <!-- 移动：主操作 + 更多 -->
    <template v-else>
      <div class="flex min-w-0 flex-1 items-center justify-end gap-1.5 overflow-x-auto">
        <el-button
          type="success"
          size="small"
          :icon="Upload"
          :loading="store.saving.value"
          @click="store.saveToGlobal()"
        >
          保存
        </el-button>
        <el-button
          size="small"
          :icon="Refresh"
          :loading="store.loading.value"
          @click="store.refreshGlobal()"
        />
        <el-button size="small" type="primary" :icon="Plus" @click="store.addJump()">
          新建
        </el-button>
        <el-dropdown trigger="click" @command="onMoreCommand">
          <el-button size="small">
            更多
            <el-icon class="el-icon--right"><ArrowDown /></el-icon>
          </el-button>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="fromUrl" :icon="Link">根据 URL 添加</el-dropdown-item>
              <el-dropdown-item command="newConfig" :icon="DocumentAdd">新建配置</el-dropdown-item>
              <el-dropdown-item command="import" :icon="FolderOpened">导入配置</el-dropdown-item>
              <el-dropdown-item command="export" :icon="Download">导出配置</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </template>

    <span
      v-if="store.dirty.value"
      class="shrink-0 text-xs text-amber-600"
    >未保存</span>

    <input
      ref="fileInput"
      type="file"
      accept="application/json,.json"
      class="hidden"
      @change="onFileChange"
    />
  </header>
</template>
