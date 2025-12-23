/**
 * 获取可用模型列表 API
 * GET /api/models/list
 */
import {
  TEXT_MODELS,
  IMAGE_MODELS,
  VIDEO_MODELS,
  VOICE_MODELS,
  getSelectedModels
} from '../../utils/model-provider'

export default defineEventHandler(async () => {
  return {
    success: true,
    models: {
      text: TEXT_MODELS,
      image: IMAGE_MODELS,
      video: VIDEO_MODELS,
      voice: VOICE_MODELS
    },
    selected: getSelectedModels()
  }
})
