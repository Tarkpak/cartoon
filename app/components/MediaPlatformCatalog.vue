<script setup lang="ts">
import { CheckCircle2, ChevronDown, KeyRound, LayoutGrid, Search } from 'lucide-vue-next'
import { credentialHint, credentialState, featuredPlatforms, filterPlatformGroups } from '@/lib/media-platforms'
import type { MediaPlatform, MediaPlatformCatalog } from '@/lib/media-platforms'

const props = defineProps<{ catalog: MediaPlatformCatalog | null, highlight?: string | null }>()

const expanded = ref(false)
const activeGroup = ref('all')
const keyword = ref('')

const featured = computed(() => props.catalog ? featuredPlatforms(props.catalog) : [])
const visibleGroups = computed(() => props.catalog ? filterPlatformGroups(props.catalog.groups, activeGroup.value, keyword.value) : [])
const credentialPlatforms = computed(() => props.catalog?.groups.flatMap(group => group.platforms).filter(platform => platform.credential?.required) || [])

function chipClass(platform: MediaPlatform) {
  if (props.highlight === platform.name) return 'border-primary bg-primary/10 text-foreground'
  return 'border-border/60 bg-background/70 text-foreground/85 hover:border-border'
}

function credentialIconClass(platform: MediaPlatform) {
  const state = credentialState(platform)
  if (state === 'missing') return 'text-warning'
  if (state === 'configured') return 'text-success'
  return 'text-muted-foreground'
}
</script>

<template>
  <section v-if="catalog" class="rounded-xl bg-muted/20 px-3 py-3 sm:px-4" aria-label="支持的平台">
    <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div class="flex items-center gap-2 text-sm font-medium text-foreground">
        <LayoutGrid class="h-4 w-4 text-muted-foreground" />
        支持 {{ catalog.total }} 个平台
      </div>
      <div v-if="!expanded" class="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        <span
          v-for="platform in featured"
          :key="platform.name"
          class="rounded-md border px-2 py-0.5 text-xs transition-colors"
          :class="chipClass(platform)"
        >
          {{ platform.name }}
        </span>
        <span class="text-xs text-muted-foreground">等</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        class="ml-auto h-8 gap-1 px-2 text-xs text-muted-foreground"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        {{ expanded ? '收起' : '查看全部' }}
        <ChevronDown class="h-3.5 w-3.5 transition-transform" :class="expanded ? 'rotate-180' : ''" />
      </Button>
    </div>

    <div v-if="expanded" class="mt-3 space-y-4">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div class="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-1">
          <button
            v-for="group in [{ key: 'all', label: '全部' }, ...catalog.groups]"
            :key="group.key"
            type="button"
            class="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium transition-colors"
            :class="activeGroup === group.key ? 'bg-foreground text-background' : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
            @click="activeGroup = group.key"
          >
            {{ group.label }}
          </button>
        </div>
        <div class="relative sm:w-44">
          <Search class="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="keyword" class="h-8 bg-background pl-8 text-xs" placeholder="搜索平台" aria-label="搜索平台" />
        </div>
      </div>

      <div v-for="group in visibleGroups" :key="group.key" class="space-y-2">
        <p class="text-xs font-medium text-muted-foreground">
          {{ group.label }} · {{ group.platforms.length }}
        </p>
        <div class="flex flex-wrap gap-1.5">
          <span
            v-for="platform in group.platforms"
            :key="platform.name"
            class="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs transition-colors"
            :class="chipClass(platform)"
            :title="credentialHint(platform)"
          >
            {{ platform.name }}
            <CheckCircle2 v-if="credentialState(platform) === 'configured'" class="h-3 w-3" :class="credentialIconClass(platform)" />
            <KeyRound v-else-if="platform.credential" class="h-3 w-3" :class="credentialIconClass(platform)" />
          </span>
        </div>
      </div>
      <p v-if="visibleGroups.length === 0" class="text-xs text-muted-foreground">没有匹配的平台</p>

      <p class="flex items-start gap-1.5 text-xs leading-5 text-muted-foreground">
        <KeyRound class="mt-0.5 h-3 w-3 shrink-0" />
        <span>
          Cookie 均为可选，可在云后台「系统设置 → 媒体解析凭据」保存，下次解析生效；未配置时直接解析。此处状态仅反映本机配置，也可在项目 .env 配置 Cookie（如 {{ credentialPlatforms.map(p => p.credential!.env).join('、') }}），重启后生效；悬停可查看说明。
        </span>
      </p>
    </div>
  </section>
</template>
