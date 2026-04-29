/**
 * 获取可用模型列表
 * GET /api/models
 */

import {
  getTextModels,
  getImageModels,
  getVideoModels,
  getVoiceModels,
  initializeSelectedModels,
  getSelectedModels
} from '../../utils/model-provider'

export default defineEventHandler(async () => {
  await initializeSelectedModels()

  return {
    success: true,
    data: {
      available: {
        text: getTextModels(),
        image: getImageModels(),
        video: getVideoModels(),
        voice: getVoiceModels()
      },
      selected: getSelectedModels()
    }
  }
})
