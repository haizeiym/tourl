<script setup lang="ts">
import { computed } from 'vue'
import { RefreshRight } from '@element-plus/icons-vue'
import type { JumpStore } from '../composables/useJumpStore'
import type { LobbyConfig, LobbyUserAccount } from '../types/jump'
import { clampMultiTabCount } from '../utils/lobby'

const props = defineProps<{
  store: JumpStore
  lobby: LobbyConfig
}>()

const multiTabCount = computed(() => clampMultiTabCount(props.lobby.multiTabCount))

const activeMultiAccounts = computed<LobbyUserAccount[]>(() => {
  const list = props.lobby.accounts ?? []
  const count = multiTabCount.value
  const result: LobbyUserAccount[] = []
  for (let i = 0; i < count; i += 1) {
    result.push({
      uuid: list[i]?.uuid ?? '',
      nickname: list[i]?.nickname ?? '',
    })
  }
  return result
})

const accountConflicts = computed(() => {
  const list = activeMultiAccounts.value
  const uuidMap = new Map<string, number[]>()
  const nickMap = new Map<string, number[]>()
  list.forEach((acc, idx) => {
    const u = acc.uuid.trim()
    const n = acc.nickname.trim()
    if (u) uuidMap.set(u, [...(uuidMap.get(u) ?? []), idx])
    if (n) nickMap.set(n, [...(nickMap.get(n) ?? []), idx])
  })
  const uuidDupIdx = new Set<number>()
  const nickDupIdx = new Set<number>()
  uuidMap.forEach((indices) => {
    if (indices.length > 1) indices.forEach((i) => uuidDupIdx.add(i))
  })
  nickMap.forEach((indices) => {
    if (indices.length > 1) indices.forEach((i) => nickDupIdx.add(i))
  })
  return {
    hasConflict: uuidDupIdx.size > 0 || nickDupIdx.size > 0,
    uuidDupIdx,
    nickDupIdx,
  }
})

const hasConflict = computed(() => accountConflicts.value.hasConflict)

function isDup(index: number): boolean {
  return (
    accountConflicts.value.uuidDupIdx.has(index) ||
    accountConflicts.value.nickDupIdx.has(index)
  )
}

function onUuidChange(index: number, val: string | number | null | undefined) {
  props.store.updateLobbyAccount(index, { uuid: String(val ?? '') })
}

function onNicknameChange(index: number, val: string | number | null | undefined) {
  props.store.updateLobbyAccount(index, { nickname: String(val ?? '') })
}
</script>

<template>
  <div class="space-y-2.5">
    <div class="flex items-center justify-between">
      <div class="text-xs font-medium text-slate-600">
        用户信息（{{ multiTabCount }} 个不重复账号）
      </div>
      <div class="flex items-center gap-1">
        <el-button
          v-if="hasConflict"
          size="small"
          type="warning"
          plain
          :icon="RefreshRight"
          @click="store.deduplicateSelectedLobbyAccounts()"
        >
          自动去重
        </el-button>
        <el-button
          size="small"
          :icon="RefreshRight"
          title="重新随机生成全部不重复的 UUID 与昵称"
          @click="store.regenerateAllLobbyAccounts()"
        >
          全部随机
        </el-button>
      </div>
    </div>

    <div
      v-if="hasConflict"
      class="rounded border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-600"
    >
      检测到重复的 UUID 或昵称，请修改或点击「自动去重」（跳转时也将自动去重以保证账号唯一）。
    </div>

    <div class="max-h-80 space-y-2 overflow-y-auto pr-0.5">
      <div
        v-for="(acc, idx) in activeMultiAccounts"
        :key="idx"
        class="space-y-1.5 rounded-md border p-2"
        :class="
          isDup(idx)
            ? 'border-red-300 bg-red-50/40'
            : 'border-slate-200 bg-slate-50/70'
        "
      >
        <div class="flex items-center justify-between text-[11px] font-medium text-slate-600">
          <span>标签窗口 #{{ idx + 1 }}</span>
          <span v-if="isDup(idx)" class="text-red-500">存在重复项</span>
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-10 shrink-0 text-[11px] text-slate-500">UUID</span>
          <el-input
            size="small"
            class="flex-1"
            :model-value="acc.uuid"
            placeholder="唯一用户 UUID"
            @update:model-value="onUuidChange(idx, $event)"
          />
          <el-button
            size="small"
            :icon="RefreshRight"
            title="随机生成不重复 UUID"
            @click="store.regenerateLobbyAccountField(idx, 'uuid')"
          />
        </div>
        <div class="flex items-center gap-1.5">
          <span class="w-10 shrink-0 text-[11px] text-slate-500">昵称</span>
          <el-input
            size="small"
            class="flex-1"
            :model-value="acc.nickname"
            placeholder="唯一用户昵称"
            @update:model-value="onNicknameChange(idx, $event)"
          />
          <el-button
            size="small"
            :icon="RefreshRight"
            title="随机生成不重复昵称"
            @click="store.regenerateLobbyAccountField(idx, 'nickname')"
          />
        </div>
      </div>
    </div>
  </div>
</template>
