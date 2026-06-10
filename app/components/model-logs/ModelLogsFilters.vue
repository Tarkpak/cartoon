<script setup lang="ts">
import { Loader2, RefreshCw, Trash2 } from 'lucide-vue-next'
import { Checkbox } from '@/components/ui/checkbox'
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

function normalizeSelectValue(value: string) {
  return value === props.allFilterValue ? '' : value
}
</script>

<template>
  <Card>
    <CardHeader class="gap-4 space-y-0 md:flex-row md:items-start md:justify-between">
      <div class="space-y-1.5">
        <CardTitle>模型调用日志</CardTitle>
        <CardDescription>用于定位模型调用问题：可查看请求参数、返回结果、耗时与错误信息</CardDescription>
      </div>
      <slot name="tabs" />
    </CardHeader>
    <CardContent class="space-y-4">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-5">
        <Select
          :model-value="provider || props.allFilterValue"
          @update:model-value="(value) => provider = normalizeSelectValue(String(value))"
        >
          <SelectTrigger class="h-9">
            <SelectValue placeholder="全部 Provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem :value="props.allFilterValue">
              全部 Provider
            </SelectItem>
            <SelectItem
              v-for="item in props.providerOptions"
              :key="item"
              :value="item"
            >
              {{ item }}
            </SelectItem>
          </SelectContent>
        </Select>

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
              {{ item }}
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
              success
            </SelectItem>
            <SelectItem value="error">
              error
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
          placeholder="Project ID"
        />
        <Input
          v-model="sceneId"
          placeholder="Scene ID"
        />
        <Input
          v-model="taskId"
          placeholder="Task ID"
        />
        <Input
          v-model="keyword"
          placeholder="请求/返回关键词"
        />

        <Input
          v-model.number="limit"
          type="number"
          min="1"
          max="500"
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
