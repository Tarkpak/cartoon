<script setup lang="ts">
import {
  CheckCircle2,
  Circle,
  Loader2,
  XCircle
} from 'lucide-vue-next'

interface ProgressStep {
  id: string
  label: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  progress?: number
  message?: string
}

interface ProgressBarProps {
  steps: ProgressStep[]
  currentStep?: string
  showDetails?: boolean
}

const props = withDefaults(defineProps<ProgressBarProps>(), {
  showDetails: true
})

const totalProgress = computed(() => {
  if (props.steps.length === 0) return 0
  const completed = props.steps.filter(s => s.status === 'completed').length
  const processing = props.steps.find(s => s.status === 'processing')
  const processingProgress = processing?.progress || 0
  return Math.round(((completed + processingProgress / 100) / props.steps.length) * 100)
})

const statusIcons = {
  pending: Circle,
  processing: Loader2,
  completed: CheckCircle2,
  failed: XCircle
}

const statusColors = {
  pending: 'text-muted-foreground',
  processing: 'text-blue-500',
  completed: 'text-green-500',
  failed: 'text-red-500'
}
</script>

<template>
  <div class="space-y-4">
    <!-- 总进度 -->
    <div>
      <div class="flex justify-between text-sm mb-2">
        <span class="font-medium">生成进度</span>
        <span class="text-muted-foreground">{{ totalProgress }}%</span>
      </div>
      <Progress :model-value="totalProgress" />
    </div>

    <!-- 步骤详情 -->
    <div
      v-if="showDetails"
      class="space-y-3"
    >
      <div
        v-for="step in steps"
        :key="step.id"
        class="flex items-start space-x-3"
      >
        <!-- 状态图标 -->
        <div class="flex-shrink-0 mt-0.5">
          <component
            :is="statusIcons[step.status]"
            class="w-5 h-5"
            :class="[
              statusColors[step.status],
              step.status === 'processing' ? 'animate-spin' : ''
            ]"
          />
        </div>

        <!-- 步骤信息 -->
        <div class="flex-1 min-w-0">
          <div class="flex items-center justify-between">
            <span
              class="font-medium"
              :class="step.status === 'pending' ? 'text-muted-foreground' : ''"
            >
              {{ step.label }}
            </span>
            <span
              v-if="step.status === 'processing' && step.progress !== undefined"
              class="text-sm text-muted-foreground"
            >
              {{ step.progress }}%
            </span>
          </div>

          <!-- 进度条（处理中时显示） -->
          <div
            v-if="step.status === 'processing'"
            class="mt-1.5"
          >
            <Progress
              :model-value="step.progress || 0"
              class="h-1 [&>div]:bg-blue-500"
            />
          </div>

          <!-- 消息 -->
          <p
            v-if="step.message"
            class="text-xs text-muted-foreground mt-1"
          >
            {{ step.message }}
          </p>
        </div>
      </div>
    </div>

    <!-- 简洁模式：步骤指示器 -->
    <div
      v-else
      class="flex items-center justify-center space-x-2"
    >
      <template
        v-for="(step, index) in steps"
        :key="step.id"
      >
        <div
          class="w-8 h-8 rounded-full flex items-center justify-center"
          :class="{
            'bg-green-100': step.status === 'completed',
            'bg-blue-100': step.status === 'processing',
            'bg-red-100': step.status === 'failed',
            'bg-muted': step.status === 'pending'
          }"
        >
          <component
            :is="statusIcons[step.status]"
            class="w-4 h-4"
            :class="[
              statusColors[step.status],
              step.status === 'processing' ? 'animate-spin' : ''
            ]"
          />
        </div>
        <div
          v-if="index < steps.length - 1"
          class="w-8 h-0.5"
          :class="step.status === 'completed' ? 'bg-green-500' : 'bg-muted'"
        />
      </template>
    </div>
  </div>
</template>
