import { onActivated, onDeactivated, ref } from 'vue'

/** Cached pages must release teleported overlays and their document interaction locks. */
export function useCachedOverlayActive() {
  const overlayActive = ref(true)
  onActivated(() => { overlayActive.value = true })
  onDeactivated(() => { overlayActive.value = false })
  return overlayActive
}
