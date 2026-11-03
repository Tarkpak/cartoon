import type { vTooltip } from '../lib/tooltip-directive'

declare module 'vue' {
  interface GlobalDirectives {
    vTooltip: typeof vTooltip
  }
}

export {}
