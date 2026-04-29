/**
 * 获取可用模型列表 API
 * GET /api/models/list
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
    models: {
      text: getTextModels(),
      image: getImageModels(),
      video: getVideoModels(),
      voice: getVoiceModels()
    },
    selected: getSelectedModels()
  }
})
