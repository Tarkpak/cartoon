import {
  getModelProviderSummaries,
  initializeSelectedModels
} from '../../utils/model-provider'

export default defineEventHandler(async () => {
  await initializeSelectedModels()

  return {
    success: true,
    data: {
      providers: getModelProviderSummaries()
    }
  }
})
