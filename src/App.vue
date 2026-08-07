<script setup lang="ts">
import { useJumpStore } from './composables/useJumpStore'
import TopBar from './components/TopBar.vue'
import JumpGrid from './components/JumpGrid.vue'
import InspectorPanel from './components/InspectorPanel.vue'
import IframePreview from './components/IframePreview.vue'

const store = useJumpStore()
</script>

<template>
  <div class="flex h-screen flex-col bg-slate-100 text-slate-800">
    <TopBar :store="store" />
    <div class="flex min-h-0 flex-1">
      <template v-if="store.isIframePreview.value">
        <IframePreview :store="store" />
      </template>
      <template v-else>
        <JumpGrid :store="store" />
        <InspectorPanel :store="store" />
      </template>
    </div>
  </div>
</template>
