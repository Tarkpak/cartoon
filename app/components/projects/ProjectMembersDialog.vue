<script setup lang="ts">
import { Loader2, Plus, ShieldCheck, Trash2, Users } from 'lucide-vue-next'
import {
  PROJECT_PERMISSION_KEYS,
  PROJECT_PERMISSION_LABELS,
  PROJECT_ROLE_LABELS,
  PROJECT_ROLE_PERMISSIONS,
  projectAccessCan,
  resolveProjectRolePermissions,
  type ProjectAccess,
  type ProjectMember,
  type ProjectMemberCandidate,
  type ProjectMemberRole,
  type ProjectPermission
} from '#shared/types/project'
import { listLibraryMembers } from '~/lib/library-api'

const props = defineProps<{
  open: boolean
  projectId: string
}>()

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
}>()

interface ProjectOwnerRow {
  userId?: string | null
  account?: string | null
  displayName?: string | null
  role: 'owner'
  permissions: ProjectPermission[]
}

const { toast } = useToast()
const { confirm } = useConfirm()
const loading = ref(false)
const savingUserId = ref<string | null>(null)
const candidates = ref<ProjectMemberCandidate[]>([])
const owner = ref<ProjectOwnerRow | null>(null)
const members = ref<ProjectMember[]>([])
const access = ref<ProjectAccess | null>(null)
const currentUserId = ref('')
const selectedUserId = ref('')
const addRole = ref<ProjectMemberRole>('editor')
const customUserId = ref<string | null>(null)
const customPermissions = ref<ProjectPermission[]>(['view'])

const canManage = computed(() => projectAccessCan(access.value, 'manage_members'))
const availableCandidates = computed(() => {
  const assigned = new Set([
    owner.value?.userId,
    ...members.value.map(member => member.userId)
  ].filter(Boolean))
  return candidates.value.filter(candidate => !assigned.has(candidate.id))
})
const selectedCandidate = computed(() => candidates.value.find(candidate => candidate.id === selectedUserId.value))

async function loadMembers() {
  if (!props.projectId) return
  loading.value = true
  try {
    const [memberResponse, memberCandidates] = await Promise.all([
      $fetch<{
        success: boolean
        data: {
          owner: ProjectOwnerRow
          members: ProjectMember[]
          access: ProjectAccess
          currentUserId: string
        }
      }>(`/api/project/${props.projectId}/members`),
      listLibraryMembers().catch(() => [])
    ])
    owner.value = memberResponse.data.owner
    members.value = memberResponse.data.members
    access.value = memberResponse.data.access
    currentUserId.value = memberResponse.data.currentUserId
    candidates.value = memberCandidates
    if (!availableCandidates.value.some(candidate => candidate.id === selectedUserId.value)) {
      selectedUserId.value = ''
    }
  } catch (error) {
    toast.error('加载项目成员失败', {
      description: error instanceof Error ? error.message : undefined
    })
  } finally {
    loading.value = false
  }
}

function normalizeRole(value: unknown): ProjectMemberRole {
  return value === 'manager' || value === 'viewer' || value === 'custom' ? value : 'editor'
}

async function saveMember(input: {
  userId: string
  account: string
  displayName: string
  role: ProjectMemberRole
  permissions?: ProjectPermission[]
}) {
  savingUserId.value = input.userId
  try {
    const response = await $fetch<{
      success: boolean
      cloudSync?: { status?: string, message?: string }
    }>(`/api/project/${props.projectId}/members/${input.userId}`, {
      method: 'PUT',
      body: {
        account: input.account,
        displayName: input.displayName,
        role: input.role,
        permissions: resolveProjectRolePermissions(input.role, input.permissions)
      }
    })
    await loadMembers()
    if (response.cloudSync?.status === 'error') {
      toast.warning('权限已在本机更新，但云端同步失败', {
        description: response.cloudSync.message
      })
    } else {
      toast.success('项目权限已更新')
    }
  } catch (error) {
    toast.error('更新项目权限失败', {
      description: error instanceof Error ? error.message : undefined
    })
  } finally {
    savingUserId.value = null
  }
}

async function addMember() {
  const candidate = selectedCandidate.value
  if (!candidate) return
  await saveMember({
    userId: candidate.id,
    account: candidate.account,
    displayName: candidate.displayName,
    role: addRole.value,
    permissions: addRole.value === 'custom' ? ['view'] : undefined
  })
  selectedUserId.value = ''
}

async function updateRole(member: ProjectMember, value: unknown) {
  const role = normalizeRole(value)
  if (role === 'custom') {
    customUserId.value = member.userId
    customPermissions.value = member.permissions.length > 0 ? [...member.permissions] : ['view']
    return
  }
  customUserId.value = null
  await saveMember({ ...member, role })
}

function toggleCustomPermission(permission: ProjectPermission, checked: boolean | 'indeterminate') {
  if (permission === 'view') return
  const next = new Set(customPermissions.value)
  if (checked === true) next.add(permission)
  else next.delete(permission)
  next.add('view')
  if (next.has('generate')) next.add('edit')
  if (permission === 'edit' && checked !== true) next.delete('generate')
  customPermissions.value = PROJECT_PERMISSION_KEYS.filter(item => next.has(item))
}

async function saveCustomPermissions(member: ProjectMember) {
  await saveMember({ ...member, role: 'custom', permissions: customPermissions.value })
  customUserId.value = null
}

async function removeMember(member: ProjectMember) {
  const accepted = await confirm({
    title: '移除项目成员',
    description: `移除后，${member.displayName || member.account} 将无法继续访问这个项目。`,
    confirmText: '移除成员',
    variant: 'destructive'
  })
  if (!accepted) return
  savingUserId.value = member.userId
  try {
    const response = await $fetch<{
      success: boolean
      cloudSync?: { status?: string, message?: string }
    }>(`/api/project/${props.projectId}/members/${member.userId}`, { method: 'DELETE' })
    await loadMembers()
    if (response.cloudSync?.status === 'error') {
      toast.warning('成员已在本机移除，但云端同步失败', {
        description: response.cloudSync.message
      })
    } else {
      toast.success('成员已移除')
    }
  } catch (error) {
    toast.error('移除成员失败', {
      description: error instanceof Error ? error.message : undefined
    })
  } finally {
    savingUserId.value = null
  }
}

watch(() => props.open, (open) => {
  if (open) void loadMembers()
})
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="max-h-[86vh] max-w-2xl grid-rows-[auto_minmax(0,1fr)] gap-0 overflow-hidden p-0">
      <DialogHeader class="px-6 pb-4 pt-6">
        <DialogTitle class="flex items-center gap-2 text-base">
          <Users class="h-4 w-4" />
          项目成员
        </DialogTitle>
        <DialogDescription>
          {{ canManage ? '为账号分配角色，或按需设置自定义权限。' : '查看当前项目的所有者和协作成员。' }}
        </DialogDescription>
      </DialogHeader>

      <div class="min-h-0 overflow-y-auto border-t">
        <div v-if="loading" class="flex min-h-52 items-center justify-center">
          <Loader2 class="h-5 w-5 animate-spin text-muted-foreground" />
        </div>

        <template v-else>
          <div v-if="canManage" class="grid gap-2 border-b bg-muted/20 px-6 py-4 sm:grid-cols-[minmax(0,1fr)_140px_auto]">
            <Select v-model="selectedUserId">
              <SelectTrigger class="h-9 min-w-0 bg-background">
                <SelectValue :placeholder="availableCandidates.length ? '选择账号' : '没有可添加账号'" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="candidate in availableCandidates" :key="candidate.id" :value="candidate.id">
                  {{ candidate.displayName }}（{{ candidate.account }}）
                </SelectItem>
              </SelectContent>
            </Select>
            <Select v-model="addRole">
              <SelectTrigger class="h-9 bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem v-for="role in ['manager', 'editor', 'viewer']" :key="role" :value="role">
                  {{ PROJECT_ROLE_LABELS[role as ProjectMemberRole] }}
                </SelectItem>
              </SelectContent>
            </Select>
            <Button class="h-9 gap-1.5 transition-transform active:scale-[0.96]" :disabled="!selectedCandidate || !!savingUserId" @click="addMember">
              <Plus class="h-4 w-4" />添加
            </Button>
          </div>

          <div class="divide-y">
            <div v-if="owner" class="flex items-center gap-3 px-6 py-4">
              <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-primary/10 text-primary">
                <ShieldCheck class="h-4 w-4" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium">{{ owner.displayName || owner.account }}</p>
                <p class="truncate text-xs text-muted-foreground">{{ owner.account }}</p>
              </div>
              <Badge variant="secondary">所有者</Badge>
            </div>

            <div v-for="member in members" :key="member.userId" class="px-6 py-4">
              <div class="flex items-center gap-3">
                <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-muted text-sm font-semibold text-muted-foreground">
                  {{ (member.displayName || member.account).slice(0, 1).toUpperCase() }}
                </div>
                <div class="min-w-0 flex-1">
                  <p class="truncate text-sm font-medium">{{ member.displayName || member.account }}</p>
                  <p class="truncate text-xs text-muted-foreground">{{ member.account }}</p>
                </div>
                <Loader2 v-if="savingUserId === member.userId" class="h-4 w-4 animate-spin text-muted-foreground" />
                <Select v-if="canManage" :model-value="member.role" :disabled="!!savingUserId" @update:model-value="updateRole(member, $event)">
                  <SelectTrigger class="h-8 w-[126px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem v-for="role in ['manager', 'editor', 'viewer', 'custom']" :key="role" :value="role">
                      {{ PROJECT_ROLE_LABELS[role as ProjectMemberRole] }}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <Badge v-else variant="outline">{{ PROJECT_ROLE_LABELS[member.role] }}</Badge>
                <Button v-if="canManage && member.userId !== currentUserId" variant="ghost" size="icon" class="h-8 w-8 text-muted-foreground hover:text-destructive" aria-label="移除项目成员" title="移除成员" :disabled="!!savingUserId" @click="removeMember(member)">
                  <Trash2 class="h-4 w-4" />
                </Button>
              </div>

              <div v-if="customUserId === member.userId" class="ml-12 mt-3 bg-muted/25 p-3 sm:mr-10">
                <div class="grid gap-2 sm:grid-cols-2">
                  <label v-for="permission in PROJECT_PERMISSION_KEYS" :key="permission" class="flex items-center gap-2 text-xs">
                    <Checkbox
                      :checked="customPermissions.includes(permission)"
                      :disabled="permission === 'view' || !!savingUserId"
                      @update:checked="toggleCustomPermission(permission, $event)"
                    />
                    {{ PROJECT_PERMISSION_LABELS[permission] }}
                  </label>
                </div>
                <div class="mt-3 flex justify-end gap-2">
                  <Button variant="ghost" size="sm" @click="customUserId = null">取消</Button>
                  <Button size="sm" :disabled="!!savingUserId" @click="saveCustomPermissions(member)">保存权限</Button>
                </div>
              </div>
            </div>

            <div v-if="members.length === 0" class="px-6 py-10 text-center text-sm text-muted-foreground">
              当前还没有协作成员
            </div>
          </div>
        </template>
      </div>
    </DialogContent>
  </Dialog>
</template>
