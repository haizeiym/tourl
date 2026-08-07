<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useJumpStore } from './composables/useJumpStore'
import { useIsMobile } from './composables/useIsMobile'
import TopBar from './components/TopBar.vue'
import JumpGrid from './components/JumpGrid.vue'
import InspectorPanel from './components/InspectorPanel.vue'
import IframePreview from './components/IframePreview.vue'

const store = useJumpStore()
const { isMobile } = useIsMobile()

/** 移动端：选中项时进入属性页；取消选中返回列表 */
const showInspectorOnMobile = computed(
  () => isMobile.value && Boolean(store.selectedId.value),
)

watch(isMobile, (mobile) => {
  // 切回桌面时保持选中即可并排显示；切到移动端若无选中则停在列表
  if (!mobile) return
})

function backToList() {
  store.clearSelection()
}

onMounted(() => {
  void store.loadGlobalConfig({ confirmDirty: false })
})
</script>

<template>
  <div class="flex h-dvh flex-col bg-slate-100 text-slate-800">
    <TopBar :store="store" :is-mobile="isMobile" />
    <div class="flex min-h-0 flex-1">
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
        <InspectorPanel :store="store" :is-mobile="false" />
      </template>
    </div>
  </div>
</template>
