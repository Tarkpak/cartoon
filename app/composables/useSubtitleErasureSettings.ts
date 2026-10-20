import { createSharedComposable, useStorage } from '@vueuse/core'
import { buildSubtitleErasureOptions, defaultSubtitleErasureSettings } from '~/lib/subtitle-erasure-settings'

export const useSubtitleErasureSettings = createSharedComposable(() => {
  const settings = useStorage('media-subtitle-erasure-settings', defaultSubtitleErasureSettings(), undefined, { mergeDefaults: true })
  return { settings, getOptions: () => buildSubtitleErasureOptions(settings.value) }
})
