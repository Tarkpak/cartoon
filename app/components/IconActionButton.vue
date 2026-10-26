<script setup lang="ts">
import { Loader2 } from 'lucide-vue-next'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const props = defineProps<{
  /** Shown in the tooltip and used as the accessible name. */
  label: string
  disabled?: boolean
  loading?: boolean
  destructive?: boolean
  /** Marks a completed state, e.g. an already downloaded file. */
  success?: boolean
  /** Toggle buttons: shows the pressed state. */
  active?: boolean
  /** Small count in the corner, e.g. number of history versions. */
  badge?: number
  /** Keeps the button usable in a read-only project (see read-only-fence). */
  readonlyAllowed?: boolean
}>()

const emit = defineEmits<{
  click: [event: MouseEvent]
}>()
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <!-- The wrapper keeps the tooltip working while the button is disabled -->
      <span class="inline-flex">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          class="relative h-7 w-7 text-muted-foreground"
          :class="props.destructive
            ? 'hover:bg-destructive/10 hover:text-destructive'
            : props.success
              ? 'text-success hover:bg-success/10 hover:text-success'
              : props.active ? 'bg-accent text-foreground' : 'hover:text-foreground'"
          :aria-pressed="props.active === undefined ? undefined : props.active"
          :disabled="props.disabled || props.loading"
          :aria-label="props.label"
          :data-readonly-allowed="props.readonlyAllowed ? '' : undefined"
          :aria-busy="props.loading || undefined"
          @click="emit('click', $event)"
        >
          <Loader2
            v-if="props.loading"
            class="h-3.5 w-3.5 animate-spin"
          />
          <slot v-else />
          <span
            v-if="props.badge"
            class="absolute -right-0.5 -top-0.5 min-w-3.5 rounded-full bg-muted px-0.5 text-[9px] font-medium leading-[14px] tabular-nums text-muted-foreground"
            aria-hidden="true"
          >
            {{ props.badge }}
          </span>
        </Button>
      </span>
    </TooltipTrigger>
    <TooltipContent>{{ props.label }}</TooltipContent>
  </Tooltip>
</template>
