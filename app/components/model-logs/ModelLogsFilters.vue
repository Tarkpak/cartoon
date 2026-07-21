<script setup lang="ts">
import { ChevronDown, Loader2, RefreshCw, Trash2 } from 'lucide-vue-next'
import { Checkbox } from '@/components/ui/checkbox'
import { modelOperationLabel, modelStatusLabel, providerLabel } from '#shared/utils/display-labels'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

const autoRefresh = defineModel<boolean>('autoRefresh', { required: true })
const provider = defineModel<string>('provider', { required: true })
const operation = defineModel<string>('operation', { required: true })
const status = defineModel<string>('status', { required: true })
const model = defineModel<string>('model', { required: true })
const requestId = defineModel<string>('requestId', { required: true })
const projectId = defineModel<string>('projectId', { required: true })
const sceneId = defineModel<string>('sceneId', { required: true })
const taskId = defineModel<string>('taskId', { required: true })
const keyword = defineModel<string>('keyword', { required: true })
const limit = defineModel<number>('limit', { required: true })

const props = defineProps<{
  loading: boolean
  clearing: boolean
  fetchError: string
  providerOptions: string[]
  operationOptions: string[]
  allFilterValue: string
}>()

const emit = defineEmits<{
  (e: 'refresh' | 'clear'): void
}>()

const filtersOpen = ref(false)

function normalizeSelectValue(value: string) {
  return value === props.allFilterValue ? '' : value
}
</script>

<template>
  <Card class="shadow-none">
    <CardHeader class="p-4">
      <div class="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(180px,1fr)_160px_140px_96px_auto] lg:items-center">
        <Input
          v-model="keyword"
          placeholder="请求/返回关键词"
        />
        <Select
          :model-value="provider || props.allFilterValue"
          @update:model-value="(value) => provider = normalizeSelectValue(String(value))"
        >
          <SelectTrigger class="h-9">
            <SelectValue placeholder="全部提供商" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="props.allFilterValue">
              全部提供商
            </SelectItem>
            <SelectItem
              v-for="item in props.providerOptions"
              :key="item"
              :value="item"
            >
              {{ providerLabel(item) }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Select
          :model-value="status || props.allFilterValue"
          @update:model-value="(value) => status = normalizeSelectValue(String(value))"
        >
          <SelectTrigger class="h-9">
            <SelectValue placeholder="全部状态" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="props.allFilterValue">
              全部状态
            </SelectItem>
            <SelectItem value="success">
              {{ modelStatusLabel('success') }}
            </SelectItem>
            <SelectItem value="error">
              {{ modelStatusLabel('error') }}
            </SelectItem>
          </SelectContent>
        </Select>
        <Input
          v-model.number="limit"
          type="number"
          min="1"
          max="500"
        />
        <div class="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="h-9 gap-1.5"
            :aria-expanded="filtersOpen"
            :aria-label="filtersOpen ? '收起筛选条件' : '展开筛选条件'"
            @click="filtersOpen = !filtersOpen"
          >
            <ChevronDown
              class="h-4 w-4 transition-transform"
              :class="{ 'rotate-180': filtersOpen }"
            />
            {{ filtersOpen ? '收起' : '筛选' }}
          </Button>
        </div>
      </div>
    </CardHeader>
    <CardContent
      v-if="filtersOpen"
      class="space-y-4 border-t p-4"
    >
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
        <Select
          :model-value="operation || props.allFilterValue"
          @update:model-value="(value) => operation = normalizeSelectValue(String(value))"
        >
          <SelectTrigger class="h-9">
            <SelectValue placeholder="全部操作" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="props.allFilterValue">
              全部操作
            </SelectItem>
            <SelectItem
              v-for="item in props.operationOptions"
              :key="item"
              :value="item"
            >
              {{ modelOperationLabel(item) }}
            </SelectItem>
          </SelectContent>
        </Select>

        <Input
          v-model="model"
          placeholder="模型名关键词"
        />
        <Input
          v-model="requestId"
          placeholder="Request ID"
        />
        <Input
          v-model="projectId"
          placeholder="项目 ID"
        />
        <Input
          v-model="sceneId"
          placeholder="场景 ID"
        />
        <Input
          v-model="taskId"
          placeholder="任务 ID"
        />
      </div>

      <div class="flex flex-wrap items-center gap-3">
        <Button
          :disabled="props.loading"
          @click="emit('refresh')"
        >
          <Loader2
            v-if="props.loading"
            class="mr-2 h-4 w-4 animate-spin"
          />
          <RefreshCw
            v-else
            class="mr-2 h-4 w-4"
          />
          刷新
        </Button>

        <Button
          variant="outline"
          :disabled="props.clearing"
          @click="emit('clear')"
        >
          <Loader2
            v-if="props.clearing"
            class="mr-2 h-4 w-4 animate-spin"
          />
          <Trash2
            v-else
            class="mr-2 h-4 w-4"
          />
          清空日志
        </Button>

        <label class="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox v-model:checked="autoRefresh" />
          自动刷新（5秒）
        </label>
      </div>

      <p
        v-if="props.fetchError"
        class="text-sm text-destructive"
      >
        {{ props.fetchError }}
      </p>
    </CardContent>
  </Card>
</template>
