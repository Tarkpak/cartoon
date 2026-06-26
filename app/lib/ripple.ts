export function createClickRipple(event: PointerEvent, className = 'button-ripple-effect') {
  const target = event.currentTarget
  if (!(target instanceof HTMLElement)) return
  if (target.matches(':disabled, [aria-disabled="true"], [data-disabled]')) return

  const rect = target.getBoundingClientRect()
  const size = Math.max(rect.width, rect.height) * 2
  const ripple = document.createElement('span')

  ripple.className = className
  ripple.style.width = `${size}px`
  ripple.style.height = `${size}px`
  ripple.style.left = `${event.clientX - rect.left - size / 2}px`
  ripple.style.top = `${event.clientY - rect.top - size / 2}px`

  target.appendChild(ripple)
  ripple.addEventListener('animationend', () => ripple.remove(), { once: true })
}
