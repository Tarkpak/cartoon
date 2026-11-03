<script setup lang="ts">
import { LockKeyhole, Users } from 'lucide-vue-next'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import type { ProjectEditSessionState } from '~/composables/useProjectEditSession'
import { summarizeProjectPresence, type ProjectParticipant } from '~/lib/project-presence'

// One header control for "who is here" and "manage members", replacing the
// presence chips and the separate members button.
const props = defineProps<{
  session: ProjectEditSessionState
  participants?: ProjectParticipant[]
  canManage: boolean
}>()

const emit = defineEmits<{
  manage: []
}>()

const MAX_AVATARS = 3

const members = computed(() => summarizeProjectPresence(props.session.collaborators, props.participants))
const visibleMembers = computed(() => members.value.slice(0, MAX_AVATARS))
const hiddenCount = computed(() => Math.max(members.value.length - MAX_AVATARS, 0))
const visible = computed(() => props.session.collaboration || props.canManage)
const triggerLabel = computed(() => {
  if (!props.session.collaboration) return '项目成员'
  if (props.session.presenceAvailable && props.session.onlineCount) return `项目成员 · ${props.session.onlineCount} 人在线`
  return '项目成员'
})

function initialOf(name: string) {
  const trimmed = name.trim()
  return trimmed ? Array.from(trimmed)[0]!.toUpperCase() : '?'
}
</script>

<template>
  <DropdownMenu v-if="visible">
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        data-readonly-allowed
        class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        :aria-label="triggerLabel"
        v-tooltip="triggerLabel"
      >
        <span
          v-if="visibleMembers.length"
          class="flex -space-x-1.5"
          aria-hidden="true"
        >
          <span
            v-for="member in visibleMembers"
            :key="member.userId"
            class="flex h-6 w-6 items-center justify-center rounded-full bg-secondary text-2xs font-semibold text-secondary-foreground ring-2 ring-background"
          >
            {{ initialOf(member.displayName) }}
          </span>
          <span
            v-if="hiddenCount"
            class="flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1 text-2xs font-medium tabular-nums ring-2 ring-background"
          >
            +{{ hiddenCount }}
          </span>
        </span>
        <Users
          v-else
          class="h-4 w-4"
          aria-hidden="true"
        />
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      class="w-72"
    >
      <DropdownMenuLabel class="flex items-center justify-between text-xs font-medium">
        <span>{{ session.collaboration ? '协作成员' : '项目成员' }}</span>
        <span
          v-if="session.presenceAvailable && session.onlineCount"
          class="inline-flex items-center gap-1.5 font-normal tabular-nums text-muted-foreground"
        >
          <span class="h-1.5 w-1.5 rounded-full bg-success" aria-hidden="true" />{{ session.onlineCount }} 人在线
        </span>
      </DropdownMenuLabel>
      <div
        v-if="members.length"
        class="max-h-64 overflow-y-auto px-1 pb-1"
      >
        <div
          v-for="member in members"
          :key="member.userId"
          class="flex items-center gap-2 rounded-sm px-2 py-1.5 text-xs"
        >
          <span class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-2xs font-semibold text-secondary-foreground">
            {{ initialOf(member.displayName) }}
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate font-medium text-foreground">{{ member.displayName }}</span>
            <span class="block truncate text-muted-foreground">{{ member.activity }}</span>
          </span>
          <LockKeyhole
            v-if="member.locked"
            class="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-label="已锁定编辑"
          />
        </div>
      </div>
      <p
        v-else-if="session.collaboration"
        class="px-3 pb-2 text-xs text-muted-foreground"
      >
        {{ session.presenceAvailable === false ? '成员状态暂不可用' : '暂时只有你在这个项目中' }}
      </p>
      <template v-if="canManage">
        <DropdownMenuSeparator />
        <DropdownMenuItem @select="emit('manage')">
          <Users class="mr-2 h-4 w-4" />
          管理项目成员
        </DropdownMenuItem>
      </template>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
