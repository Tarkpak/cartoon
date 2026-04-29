import {
  getCustomOpenAIProviderPublicConfig,
  initializeSelectedModels
} from '../../utils/model-provider'

export default defineEventHandler(async () => {
  await initializeSelectedModels()

  return {
    success: true,
    data: getCustomOpenAIProviderPublicConfig()
  }
})
