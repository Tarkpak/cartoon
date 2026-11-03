import type { Directive } from 'vue'

/**
 * `v-tooltip="'复制链接'"` — a styled replacement for the native `title`
 * attribute on icon-only controls. One shared bubble is positioned above (or
 * below, when there is no room) the hovered or focused element. When the
 * element has no accessible name, the text also becomes its aria-label.
 */

type TooltipValue = string | null | undefined | false

interface TooltipState {
  text: string
  setAriaLabel: boolean
  timer: ReturnType<typeof setTimeout> | null
  show: () => void
  hide: () => void
}

const SHOW_DELAY_MS = 300
const GAP_PX = 6
const VIEWPORT_MARGIN_PX = 8
const states = new WeakMap<HTMLElement, TooltipState>()
let bubble: HTMLDivElement | null = null
let activeElement: HTMLElement | null = null

function ensureBubble(): HTMLDivElement {
  if (bubble?.isConnected) return bubble
  bubble = document.createElement('div')
  bubble.setAttribute('role', 'tooltip')
  bubble.className = 'pointer-events-none fixed z-[10000] max-w-xs rounded-md bg-foreground px-2 py-1 text-xs text-background shadow-md transition-opacity duration-100'
  bubble.style.opacity = '0'
  bubble.style.left = '0px'
  bubble.style.top = '0px'
  document.body.appendChild(bubble)
  return bubble
}

function position(target: HTMLElement, element: HTMLDivElement) {
  const rect = target.getBoundingClientRect()
  const tip = element.getBoundingClientRect()
  const left = Math.min(
    Math.max(rect.left + rect.width / 2 - tip.width / 2, VIEWPORT_MARGIN_PX),
    window.innerWidth - tip.width - VIEWPORT_MARGIN_PX
  )
  const above = rect.top - tip.height - GAP_PX
  const top = above >= VIEWPORT_MARGIN_PX ? above : rect.bottom + GAP_PX
  element.style.left = `${Math.round(left)}px`
  element.style.top = `${Math.round(top)}px`
}

function hideActive() {
  if (activeElement) states.get(activeElement)?.hide()
}

function normalize(value: TooltipValue): string {
  return typeof value === 'string' ? value.trim() : ''
}

function syncAriaLabel(el: HTMLElement, state: TooltipState) {
  if (!state.setAriaLabel) return
  if (state.text) el.setAttribute('aria-label', state.text)
  else el.removeAttribute('aria-label')
}

function onScrollOrResize() {
  hideActive()
}

export const vTooltip: Directive<HTMLElement, TooltipValue> = {
  mounted(el, binding) {
    const state: TooltipState = {
      text: normalize(binding.value),
      // Only own aria-label when the author didn't provide one.
      setAriaLabel: !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby'),
      timer: null,
      show() {
        if (!state.text) return
        if (state.timer) clearTimeout(state.timer)
        state.timer = setTimeout(() => {
          state.timer = null
          if (!el.isConnected) return
          if (activeElement && activeElement !== el) hideActive()
          const element = ensureBubble()
          element.textContent = state.text
          element.id = 'app-tooltip'
          position(el, element)
          element.style.opacity = '1'
          activeElement = el
          el.setAttribute('aria-describedby', 'app-tooltip')
          window.addEventListener('scroll', onScrollOrResize, true)
          window.addEventListener('resize', onScrollOrResize)
        }, SHOW_DELAY_MS)
      },
      hide() {
        if (state.timer) {
          clearTimeout(state.timer)
          state.timer = null
        }
        if (activeElement !== el) return
        activeElement = null
        el.removeAttribute('aria-describedby')
        if (bubble) bubble.style.opacity = '0'
        window.removeEventListener('scroll', onScrollOrResize, true)
        window.removeEventListener('resize', onScrollOrResize)
      }
    }
    states.set(el, state)
    syncAriaLabel(el, state)
    el.addEventListener('pointerenter', state.show)
    el.addEventListener('pointerleave', state.hide)
    el.addEventListener('focusin', state.show)
    el.addEventListener('focusout', state.hide)
    el.addEventListener('pointerdown', state.hide)
    el.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') state.hide()
    })
  },
  updated(el, binding) {
    const state = states.get(el)
    if (!state) return
    state.text = normalize(binding.value)
    syncAriaLabel(el, state)
    if (!state.text) state.hide()
    else if (activeElement === el && bubble) bubble.textContent = state.text
  },
  beforeUnmount(el) {
    const state = states.get(el)
    if (!state) return
    state.hide()
    el.removeEventListener('pointerenter', state.show)
    el.removeEventListener('pointerleave', state.hide)
    el.removeEventListener('focusin', state.show)
    el.removeEventListener('focusout', state.hide)
    el.removeEventListener('pointerdown', state.hide)
    states.delete(el)
  }
}
