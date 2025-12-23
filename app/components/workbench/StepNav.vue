<script setup lang="ts">
import { Check, FileText, Users, Film, Video, Music } from 'lucide-vue-next'

export interface WorkflowStep {
  key: string
  label: string
  icon: any
  description: string
  completed: boolean
  active: boolean
}

const props = defineProps<{
  steps: WorkflowStep[]
  currentStep: string
}>()

const emit = defineEmits<{
  'update:currentStep': [step: string]
}>()

function canNavigateTo(stepIndex: number): boolean {
  // 允许导航到任何步骤（开发阶段）
  // 生产环境可以改为：只能导航到已完成的步骤或当前步骤的下一步
  return true
  // if (stepIndex === 0) return true
  // const prevStep = props.steps[stepIndex - 1]
  // return prevStep?.completed || false
}

function handleStepClick(step: WorkflowStep, index: number) {
  if (canNavigateTo(index)) {
    emit('update:currentStep', step.key)
  }
}
</script>

<template>
  <div class="flex items-center justify-between mb-6 px-4">
    <template
      v-for="(step, index) in steps"
      :key="step.key"
    >
      <!-- 步骤项 -->
      <div
        class="flex items-center cursor-pointer group"
        :class="canNavigateTo(index) ? '' : 'cursor-not-allowed opacity-50'"
        @click="handleStepClick(step, index)"
      >
        <!-- 步骤图标 -->
        <div
          class="w-10 h-10 rounded-full flex items-center justify-center transition-all"
          :class="[
            step.active
              ? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
              : step.completed
                ? 'bg-green-500 text-white'
                : 'bg-muted text-muted-foreground group-hover:bg-accent'
          ]"
        >
          <Check
            v-if="step.completed && !step.active"
            class="w-5 h-5"
          />
          <component
            :is="step.icon"
            v-else
            class="w-5 h-5"
          />
        </div>

        <!-- 步骤文字 -->
        <div class="ml-3">
          <div
            class="text-sm font-medium transition"
            :class="step.active ? 'text-primary' : step.completed ? 'text-foreground' : 'text-muted-foreground'"
          >
            {{ step.label }}
          </div>
          <div class="text-xs text-muted-foreground hidden sm:block">
            {{ step.description }}
          </div>
        </div>
      </div>

      <!-- 连接线 -->
      <div
        v-if="index < steps.length - 1"
        class="flex-1 h-0.5 mx-4 transition-colors"
        :class="steps[index]?.completed ? 'bg-green-500' : 'bg-muted'"
      />
    </template>
  </div>
</template>
