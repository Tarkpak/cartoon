<template>
  <AdminShell>
    <div class="page">
      <div class="page-header page-header--actions">
        <n-button type="primary" @click="showCreate = true">新建用户</n-button>
      </div>

      <n-space vertical class="table-section">
        <n-input v-model:value="keyword" placeholder="搜索账号、名称、邮箱或手机号" clearable @keyup.enter="refreshUsers" />
        <n-data-table
          :columns="columns"
          :data="rows"
          :loading="pending"
          :row-props="rowProps"
          :pagination="usersPagination"
          remote
          @update:page="handlePageChange"
          @update:page-size="handlePageSizeChange"
        />
      </n-space>

      <n-modal v-model:show="showCreate" preset="card" title="新建用户" style="width: 480px">
        <n-form>
          <n-form-item label="账号">
            <n-input v-model:value="createForm.account" />
          </n-form-item>
          <n-form-item label="显示名称">
            <n-input v-model:value="createForm.displayName" />
          </n-form-item>
          <n-form-item label="密码">
            <n-input v-model:value="createForm.password" type="password" show-password-on="click" />
          </n-form-item>
          <n-form-item label="角色">
            <n-select v-model:value="createForm.role" :options="roleOptions" />
          </n-form-item>
          <n-space justify="end">
            <n-button @click="showCreate = false">取消</n-button>
            <n-button type="primary" :loading="creating" @click="createUser">创建</n-button>
          </n-space>
        </n-form>
      </n-modal>
    </div>
  </AdminShell>
</template>

<script setup lang="ts">
import { h } from 'vue'
import { NButton, NTag, useMessage } from 'naive-ui'
import { userRoleLabel, userStatusLabel } from '@playlet-shared/utils/display-labels'

interface UserRow {
  id: string
  account: string
  display_name: string
  role: string
  status: string
  last_login_at?: string
  created_at: string
  credit_balance: number
  credits_consumed: number
}

const router = useRouter()
const message = useMessage()
const keyword = ref('')
const pending = ref(false)
const rows = ref<UserRow[]>([])
const page = ref(1)
const pageSize = ref(20)
const total = ref(0)
const showCreate = ref(false)
const creating = ref(false)
const createForm = reactive({
  account: '',
  displayName: '',
  password: '',
  role: 'user'
})
const roleOptions = [
  { label: '普通用户', value: 'user' },
  { label: '管理员', value: 'admin' }
]

const usersPagination = computed(() => ({
  page: page.value,
  pageSize: pageSize.value,
  itemCount: total.value,
  pageCount: Math.max(1, Math.ceil(total.value / pageSize.value)),
  showSizePicker: true,
  pageSizes: [10, 20, 50, 100],
  prefix: ({ itemCount }: { itemCount: number }) => `共 ${itemCount} 个用户`
}))

const columns = [
  { title: '账号', key: 'account' },
  { title: '名称', key: 'display_name' },
  {
    title: '角色',
    key: 'role',
    render(row: UserRow) {
      return h(NTag, { size: 'small', type: row.role === 'admin' ? 'warning' : 'info' }, { default: () => userRoleLabel(row.role) })
    }
  },
  {
    title: '状态',
    key: 'status',
    render(row: UserRow) {
      return h(NTag, { size: 'small', type: row.status === 'active' ? 'success' : 'error' }, { default: () => userStatusLabel(row.status) })
    }
  },
  {
    title: '积分余额',
    key: 'credit_balance',
    width: 110
  },
  {
    title: '累计消耗',
    key: 'credits_consumed',
    width: 110
  },
  {
    title: '最近登录',
    key: 'last_login_at',
    width: 180,
    render(row: UserRow) {
      return formatAdminDateTime(row.last_login_at)
    }
  },
  {
    title: '操作',
    key: 'actions',
    render(row: UserRow) {
      return h(
        NButton,
        {
          size: 'small',
          type: row.status === 'active' ? 'error' : 'success',
          onClick: (event: MouseEvent) => {
            event.stopPropagation()
            void updateStatus(row)
          }
        },
        { default: () => row.status === 'active' ? '禁用' : '启用' }
      )
    }
  }
]

function rowProps(row: UserRow) {
  return {
    class: 'users-table-row',
    onClick: () => router.push(`/users/${row.id}`)
  }
}

async function fetchUsers() {
  pending.value = true
  try {
    const response = await $fetch<{ data: { users: UserRow[], pagination: { total: number } } }>('/api/admin/users', {
      query: { keyword: keyword.value, page: page.value, pageSize: pageSize.value }
    })
    rows.value = response.data.users
    total.value = response.data.pagination.total
  } finally {
    pending.value = false
  }
}

function refreshUsers() {
  page.value = 1
  void fetchUsers()
}

function handlePageChange(value: number) {
  page.value = value
  void fetchUsers()
}

function handlePageSizeChange(value: number) {
  pageSize.value = value
  page.value = 1
  void fetchUsers()
}

async function createUser() {
  creating.value = true
  try {
    await $fetch('/api/admin/users', {
      method: 'POST',
      body: createForm
    })
    message.success('用户已创建')
    showCreate.value = false
    Object.assign(createForm, { account: '', displayName: '', password: '', role: 'user' })
    await fetchUsers()
  } catch (err) {
    message.error(err instanceof Error ? err.message : '创建失败')
  } finally {
    creating.value = false
  }
}

async function updateStatus(row: UserRow) {
  await $fetch(`/api/admin/users/${row.id}/status`, {
    method: 'PATCH',
    body: { status: row.status === 'active' ? 'disabled' : 'active' }
  })
  await fetchUsers()
}

onMounted(fetchUsers)
</script>

<style scoped>
:deep(.users-table-row) {
  cursor: pointer;
}

:deep(.users-table-row:hover td) {
  background: rgba(24, 160, 88, 0.06);
}
</style>
