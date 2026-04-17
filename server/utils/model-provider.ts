/**
 * 统一模型提供商管理器
 * 支持在不同 AI 服务商之间切换
 */

import type {
  ModelProvider,
  TextModelConfig,
  ImageModelConfig,
  VideoModelConfig,
  VoiceModelConfig,
  SelectedModels
} from '../../shared/types/provider'
import { eq } from 'drizzle-orm'
import { db, systemConfig } from '../db'

import * as gemini from './gemini'
import * as qwen from './qwen'
import * as kling from './kling'
import * as volcengine from './volcengine'

// 注意: GeminiError/GeminiErrorCode 请从 './gemini' 导入
// 注意: QwenError/QwenErrorCode 请从 './qwen' 导入

// ============================================================
// 可用模型配置
// ============================================================

/** 所有可用的文本模型 */
export const TEXT_MODELS: TextModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.TextModels.GENERAL,
    displayName: 'Gemini 3 Flash',
    description: '快速响应，适合通用任务',
    supportThinking: false,
    docUrl: 'https://ai.google.dev/gemini-api/docs'
  },
  {
    provider: 'gemini',
    model: gemini.TextModels.SCRIPT_PARSER,
    displayName: 'Gemini 3.1 Pro Preview',
    description: '高级推理能力，适合复杂剧本解析',
    supportThinking: false,
    docUrl: 'https://ai.google.dev/gemini-api/docs'
  },
  // 千问模型
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.QWEN3_MAX,
    displayName: '通义千问3-Max',
    description: '适配复杂场景，达到领域SOTA水平',
    supportThinking: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.QWEN_FLASH,
    displayName: '通义千问-Flash',
    description: '小尺寸，低延时，高性价比',
    supportThinking: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.QWEN_PLUS_THINKING,
    displayName: '通义千问3.6-Plus (深度思考)',
    description: '新一代高性能深度思考模型',
    supportThinking: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.QWEN_FLASH_THINKING,
    displayName: '通义千问3.5-Flash (深度思考)',
    description: '低延时深度思考版本，适合高并发场景',
    supportThinking: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenTextModels.DEEPSEEK_V3_2,
    displayName: 'DeepSeek-V3.2',
    description: '全新混合推理架构模型',
    supportThinking: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/deepseek-api'
  },
  // 火山引擎 (豆包) 模型
  {
    provider: 'volcengine',
    model: volcengine.VolcengineTextModels.DOUBAO_SEED_2_0_PRO,
    displayName: '豆包 Seed 2.0 Pro',
    description: '旗舰文本模型，复杂任务表现最强',
    supportThinking: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  },
  {
    provider: 'volcengine',
    model: volcengine.VolcengineTextModels.DOUBAO_SEED_2_0_MINI,
    displayName: '豆包 Seed 2.0 Mini',
    description: '高性价比通用模型，适合日常生产任务',
    supportThinking: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  },
  {
    provider: 'volcengine',
    model: volcengine.VolcengineTextModels.DOUBAO_SEED_2_0_LITE,
    displayName: '豆包 Seed 2.0 Lite',
    description: '轻量低成本模型，适合简单文本任务',
    supportThinking: false,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  },
  {
    provider: 'volcengine',
    model: volcengine.VolcengineTextModels.DOUBAO_SEED_CODE,
    displayName: '豆包 Seed Code Preview',
    description: '代码生成与修复场景增强',
    supportThinking: false,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  },
  {
    provider: 'volcengine',
    model: volcengine.VolcengineTextModels.DEEPSEEK_V3_2,
    displayName: 'DeepSeek-V3.2 (火山)',
    description: 'DeepSeek最新版 (火山引擎)',
    supportThinking: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  }
]

/** 所有可用的图片模型 */
export const IMAGE_MODELS: ImageModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.ImageModels.HIGH_QUALITY,
    displayName: 'Gemini 3 Pro Image',
    description: '4K高质量图片生成',
    supportReferenceImage: true,
    docUrl: 'https://ai.google.dev/gemini-api/docs/image-generation'
  },
  {
    provider: 'gemini',
    model: gemini.ImageModels.FAST,
    displayName: 'Gemini 3.1 Flash Image',
    description: '快速生成',
    supportReferenceImage: true,
    docUrl: 'https://ai.google.dev/gemini-api/docs/image-generation'
  },
  // 千问模型
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.QWEN_IMAGE_2_PRO,
    displayName: '通义千问-Image-2.0-Pro',
    description: '新一代高质量图像生成与编辑',
    supportReferenceImage: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-image-api'
  },
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.QWEN_IMAGE_2,
    displayName: '通义千问-Image-2.0',
    description: '高性能图像生成模型，兼顾质量和速度',
    supportReferenceImage: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-image-api'
  },
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.QWEN_IMAGE_PLUS,
    displayName: '通义千问-Image-Plus',
    description: '文生图，文本卓越渲染出画',
    supportReferenceImage: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-image-api'
  },
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.WAN_2_6_IMAGE,
    displayName: '通义万相2.6-图像编辑',
    description: '图像编辑/风格迁移，需1-4张参考图',
    supportReferenceImage: true,
    requireReferenceImage: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/wan-image-generation-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.WAN_2_6_T2I,
    displayName: '通义万相2.6-文生图',
    description: '精准指令遵循，真实质感显著提升',
    supportReferenceImage: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/text-to-image-v2-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenImageModels.Z_IMAGE_TURBO,
    displayName: 'Z-Image-Turbo',
    description: '高性价比，照片级品质',
    supportReferenceImage: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/z-image-api-reference'
  },
  // 可灵 AI 图片模型
  {
    provider: 'kling',
    model: kling.KlingImageModels.KLING_IMAGE_O1,
    displayName: '可灵 Kling Image O1',
    description: 'Omni 图像模型，支持多图参考、主体融合与组图',
    supportReferenceImage: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/OmniImage'
  },
  {
    provider: 'kling',
    model: kling.KlingImageModels.KLING_V3_OMNI,
    displayName: '可灵 Kling v3 Omni（图像）',
    description: 'Omni 图像模型，支持 1K/2K/4K 与主体/图片混合参考',
    supportReferenceImage: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/OmniImage'
  },
  {
    provider: 'kling',
    model: kling.KlingImageModels.KLING_V3,
    displayName: '可灵 Kling v3（图像）',
    description: '新一代图像模型，支持文生图/图生图',
    supportReferenceImage: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/imageGeneration'
  },
  {
    provider: 'kling',
    model: kling.KlingImageModels.KLING_V2_1,
    displayName: '可灵 Kling v2.1（图像）',
    description: '支持文生图/图生图/多图参考生图',
    supportReferenceImage: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/imageGeneration'
  },
  {
    provider: 'kling',
    model: kling.KlingImageModels.KLING_V2_NEW,
    displayName: '可灵 Kling v2 New（图像）',
    description: '风格转绘模型，建议搭配参考图使用',
    supportReferenceImage: true,
    requireReferenceImage: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/imageGeneration'
  },
  {
    provider: 'kling',
    model: kling.KlingImageModels.KLING_V2,
    displayName: '可灵 Kling v2',
    description: '可灵高质量图片模型，支持文生图/图生图/多图参考',
    supportReferenceImage: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/imageGeneration'
  },
  {
    provider: 'kling',
    model: kling.KlingImageModels.KLING_V1_5,
    displayName: '可灵 Kling v1.5',
    description: '可灵图片模型，支持角色/人脸一致性控制',
    supportReferenceImage: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/imageGeneration'
  },
  {
    provider: 'kling',
    model: kling.KlingImageModels.KLING_V1,
    displayName: '可灵 Kling v1',
    description: '可灵经典图片模型，适合通用图片生成',
    supportReferenceImage: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/imageGeneration'
  },
  // 火山引擎 (豆包 Seedream) 图片模型
  {
    provider: 'volcengine',
    model: volcengine.VolcengineImageModels.SEEDREAM_5_0,
    displayName: '豆包 Seedream 5.0',
    description: '最新旗舰图片模型，支持文生图/图生图/多参考图',
    supportReferenceImage: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  },
  {
    provider: 'volcengine',
    model: volcengine.VolcengineImageModels.SEEDREAM_5_0_LITE,
    displayName: '豆包 Seedream 5.0 Lite',
    description: '高速高性价比图片生成',
    supportReferenceImage: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  },
  {
    provider: 'volcengine',
    model: volcengine.VolcengineImageModels.SEEDREAM_4_5,
    displayName: '豆包 Seedream 4.5',
    description: '高质量图片生成模型',
    supportReferenceImage: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  }
]

/** 所有可用的视频模型 */
export const VIDEO_MODELS: VideoModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.VideoModels.VEO_3_1,
    displayName: 'Veo 3.1',
    description: '支持首尾帧插值',
    maxDuration: 8,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 3,
    supportTextToVideo: true,
    docUrl: 'https://ai.google.dev/gemini-api/docs/video'
  },
  {
    provider: 'gemini',
    model: gemini.VideoModels.VEO_3_1_FAST,
    displayName: 'Veo 3.1 Fast',
    description: '速度优化版本（Fast）',
    maxDuration: 8,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 3,
    supportTextToVideo: true,
    docUrl: 'https://ai.google.dev/gemini-api/docs/video'
  },
  {
    provider: 'gemini',
    model: gemini.VideoModels.VEO_3_1_LITE,
    displayName: 'Veo 3.1 Lite',
    description: '轻量版本（不支持多参考图）',
    maxDuration: 8,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: false,
    supportTextToVideo: true,
    docUrl: 'https://ai.google.dev/gemini-api/docs/video'
  },
  // 千问模型 (通义万相)
  {
    provider: 'qwen',
    model: qwen.QwenVideoModels.WAN_2_2_KF2V_FLASH,
    displayName: '通义万相2.2-首尾帧生视频(推荐)',
    description: '极速版，较2.1速度提升50%，支持480P/720P/1080P',
    maxDuration: 5,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/wanx-keyframe-to-video-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenVideoModels.WAN_2_1_KF2V_PLUS,
    displayName: '通义万相2.1-首尾帧生视频(专业版)',
    description: '复杂运动，物理规律还原，画面细腻，720P',
    maxDuration: 5,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/wanx-keyframe-to-video-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenVideoModels.WAN_2_6_T2V,
    displayName: '通义万相2.6-文生视频',
    description: '全新参考生视频，智能多镜，15秒时长',
    maxDuration: 15,
    supportFirstLastFrame: false,
    supportImageToVideo: false,
    supportTextToVideo: true,
    docUrl: 'https://help.aliyun.com/zh/model-studio/text-to-video-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenVideoModels.WAN_2_6_I2V,
    displayName: '通义万相2.6-图生视频',
    description: '智能分镜，最高15秒视频生成',
    maxDuration: 15,
    supportFirstLastFrame: false,
    supportImageToVideo: true,
    supportTextToVideo: false,
    docUrl: 'https://help.aliyun.com/zh/model-studio/image-to-video-api-reference'
  },
  // 可灵 AI 视频模型
  {
    provider: 'kling',
    model: kling.KlingVideoModels.KLING_VIDEO_O1,
    displayName: '可灵 Kling Video O1',
    description: 'Omni 视频模型，支持文本/图片/视频混合参考与多镜头',
    maxDuration: 10,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 7,
    supportTextToVideo: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/OmniVideo'
  },
  {
    provider: 'kling',
    model: kling.KlingVideoModels.KLING_V3_OMNI,
    displayName: '可灵 Kling v3 Omni（视频）',
    description: 'Omni 3.0 视频模型，支持多镜头与复杂主体控制',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 7,
    supportTextToVideo: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/OmniVideo'
  },
  {
    provider: 'kling',
    model: kling.KlingVideoModels.KLING_V3,
    displayName: '可灵 Kling v3',
    description: '可灵最新视频模型，支持文生/图生/首尾帧，3-15秒',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/videoModels'
  },
  {
    provider: 'kling',
    model: kling.KlingVideoModels.KLING_V2_6,
    displayName: '可灵 Kling v2.6',
    description: '通用高质量视频模型，支持文生/图生/首尾帧，3-15秒',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/videoModels'
  },
  {
    provider: 'kling',
    model: kling.KlingVideoModels.KLING_V2_5_TURBO,
    displayName: '可灵 Kling v2.5 Turbo',
    description: '可灵高性价比视频模型，适合快速生成',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/videoModels'
  },
  {
    provider: 'kling',
    model: kling.KlingVideoModels.KLING_V2_1_MASTER,
    displayName: '可灵 Kling v2.1 Master',
    description: '可灵高画质视频模型，支持文生/图生/首尾帧',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/videoModels'
  },
  {
    provider: 'kling',
    model: kling.KlingVideoModels.KLING_V2_MASTER,
    displayName: '可灵 Kling v2 Master',
    description: '可灵 v2 主力模型，支持文生/图生视频',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/videoModels'
  },
  {
    provider: 'kling',
    model: kling.KlingVideoModels.KLING_V2_1,
    displayName: '可灵 Kling v2.1',
    description: '可灵稳定版图生视频模型，支持首尾帧控制',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: false,
    docUrl: 'https://klingai.com/document-api/apiReference/model/videoModels'
  },
  {
    provider: 'kling',
    model: kling.KlingVideoModels.KLING_V1_6,
    displayName: '可灵 Kling v1.6',
    description: '可灵稳定版视频模型，支持文生/图生视频',
    maxDuration: 10,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportTextToVideo: true,
    docUrl: 'https://klingai.com/document-api/apiReference/model/videoModels'
  },
  // 火山引擎 (豆包 Seedance) 视频模型 - 仅保留支持首尾帧的模型
  {
    provider: 'volcengine',
    model: volcengine.VolcengineVideoModels.SEEDANCE_2_0,
    displayName: '豆包 Seedance 2.0',
    description: '最新视频模型，支持首尾帧/首帧/文生视频（4-15秒）',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 9,
    supportTextToVideo: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  },
  {
    provider: 'volcengine',
    model: volcengine.VolcengineVideoModels.SEEDANCE_2_0_FAST,
    displayName: '豆包 Seedance 2.0 Fast',
    description: '高速视频模型，支持首尾帧与图生视频（4-15秒）',
    maxDuration: 15,
    supportFirstLastFrame: true,
    supportImageToVideo: true,
    supportReferenceImages: true,
    maxReferenceImages: 9,
    supportTextToVideo: true,
    docUrl: 'https://www.volcengine.com/docs/82379/1330310'
  }
]

/** 所有可用的语音模型 */
export const VOICE_MODELS: VoiceModelConfig[] = [
  // Gemini 模型
  {
    provider: 'gemini',
    model: gemini.AudioModels.LYRIA,
    displayName: 'Lyria',
    description: '背景音乐生成',
    type: 'tts',
    docUrl: 'https://ai.google.dev/gemini-api/docs/audio'
  },
  // 千问模型
  {
    provider: 'qwen',
    model: qwen.QwenVoiceModels.QWEN3_TTS_FLASH,
    displayName: '通义千问3-TTS-Instruct-Flash',
    description: '高表现力多语言拟人音色',
    type: 'tts',
    supportedLanguages: ['zh', 'en', 'ja', 'ko'],
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-tts-api'
  },
  {
    provider: 'qwen',
    model: qwen.QwenVoiceModels.QWEN3_ASR_FLASH,
    displayName: '通义千问3-ASR-Flash',
    description: '精准多语言转写与情绪识别',
    type: 'asr',
    supportedLanguages: ['zh', 'en', 'ja', 'ko'],
    docUrl: 'https://help.aliyun.com/zh/model-studio/qwen-asr-api-reference'
  },
  {
    provider: 'qwen',
    model: qwen.QwenVoiceModels.FUN_ASR_MTL,
    displayName: '百聆-FUN-ASR-Mtl',
    description: '高准确率方言及多语言语音识别',
    type: 'asr',
    supportedLanguages: ['zh', 'en', 'ja', 'ko', 'yue', 'wuu'],
    docUrl: 'https://help.aliyun.com/zh/model-studio/fun-asr-recorded-speech-recognition-api-reference'
  }
]

// ============================================================
// 当前选择的模型（内存 + 数据库存储）
// ============================================================

const SELECTED_MODELS_KEY = 'selected_models'

const DEFAULT_SELECTED_MODELS: SelectedModels = {
  text: qwen.QwenTextModels.QWEN_FLASH, // 默认使用千问
  image: qwen.QwenImageModels.WAN_2_6_T2I, // 默认使用千问
  video: qwen.QwenVideoModels.WAN_2_6_T2V, // 默认使用千问
  tts: qwen.QwenVoiceModels.QWEN3_TTS_FLASH,
  asr: qwen.QwenVoiceModels.QWEN3_ASR_FLASH
}

const currentModels: SelectedModels = { ...DEFAULT_SELECTED_MODELS }
let selectedModelsInitialized = false

function isValidModelForType(type: keyof SelectedModels, modelId: string): boolean {
  switch (type) {
    case 'text':
      return !!findTextModel(modelId)
    case 'image':
      return !!findImageModel(modelId)
    case 'video':
      return !!findVideoModel(modelId)
    case 'tts': {
      const voice = findVoiceModel(modelId)
      return !!voice && voice.type === 'tts'
    }
    case 'asr': {
      const voice = findVoiceModel(modelId)
      return !!voice && voice.type === 'asr'
    }
    default:
      return false
  }
}

function normalizeSelectedModels(raw: unknown): SelectedModels {
  const normalized: SelectedModels = { ...DEFAULT_SELECTED_MODELS }

  if (!raw || typeof raw !== 'object') {
    return normalized
  }

  const source = raw as Partial<Record<keyof SelectedModels, unknown>>
  const keys: Array<keyof SelectedModels> = ['text', 'image', 'video', 'tts', 'asr']

  for (const key of keys) {
    const value = source[key]
    if (typeof value === 'string' && isValidModelForType(key, value)) {
      normalized[key] = value
    }
  }

  return normalized
}

async function saveSelectedModelsToDB(models: SelectedModels): Promise<void> {
  const now = new Date().toISOString()
  await db.insert(systemConfig)
    .values({
      key: SELECTED_MODELS_KEY,
      value: JSON.stringify(models),
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: systemConfig.key,
      set: {
        value: JSON.stringify(models),
        updatedAt: now
      }
    })
}

/**
 * 初始化全局模型选择（从数据库恢复）
 */
export async function initializeSelectedModels(): Promise<void> {
  if (selectedModelsInitialized) {
    return
  }

  try {
    const rows = await db.select()
      .from(systemConfig)
      .where(eq(systemConfig.key, SELECTED_MODELS_KEY))
      .limit(1)

    const row = rows[0]
    if (row?.value) {
      const parsed = JSON.parse(row.value)
      const normalized = normalizeSelectedModels(parsed)
      Object.assign(currentModels, normalized)
      console.log('[Models] 已从数据库加载全局模型配置')
    } else {
      await saveSelectedModelsToDB(currentModels)
      console.log('[Models] 已写入默认全局模型配置')
    }
  } catch (error) {
    console.error('[Models] 初始化全局模型配置失败，使用默认值:', error)
  } finally {
    selectedModelsInitialized = true
  }
}

export function getSelectedModels(): SelectedModels {
  return { ...currentModels }
}

export async function setSelectedModel(type: keyof SelectedModels, modelId: string): Promise<void> {
  currentModels[type] = modelId
  await saveSelectedModelsToDB(currentModels)
}

// ============================================================
// 模型查找辅助函数
// ============================================================

export function findTextModel(modelId: string): TextModelConfig | undefined {
  return TEXT_MODELS.find(m => m.model === modelId)
}

export function findImageModel(modelId: string): ImageModelConfig | undefined {
  return IMAGE_MODELS.find(m => m.model === modelId)
}

export function findVideoModel(modelId: string): VideoModelConfig | undefined {
  return VIDEO_MODELS.find(m => m.model === modelId)
}

export function findVoiceModel(modelId: string): VoiceModelConfig | undefined {
  return VOICE_MODELS.find(m => m.model === modelId)
}

function getProviderFromModel(modelId: string): ModelProvider {
  const allModels = [...TEXT_MODELS, ...IMAGE_MODELS, ...VIDEO_MODELS, ...VOICE_MODELS]
  const model = allModels.find(m => m.model === modelId)
  return model?.provider || 'gemini'
}

// ============================================================
// 统一 API 封装 - 文本生成
// ============================================================

export async function generateText(options: {
  modelId?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
  enableThinking?: boolean
}): Promise<string> {
  const modelId = options.modelId || currentModels.text
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] generateText - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenGenerateText({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries,
      enableThinking: options.enableThinking
    })
  }

  if (provider === 'volcengine') {
    return volcengine._volcengineGenerateText({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries,
      enableThinking: options.enableThinking
    })
  }

  // 默认使用 Gemini
  return gemini._geminiGenerateText({
    model: modelId,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })
}

export async function generateJSON<T>(options: {
  modelId?: string
  prompt: string
  systemInstruction?: string
  temperature?: number
  maxRetries?: number
}): Promise<T> {
  const modelId = options.modelId || currentModels.text
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] generateJSON - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenGenerateJSON<T>({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  if (provider === 'volcengine') {
    return volcengine._volcengineGenerateJSON<T>({
      model: modelId,
      prompt: options.prompt,
      systemInstruction: options.systemInstruction,
      temperature: options.temperature,
      maxRetries: options.maxRetries
    })
  }

  return gemini._geminiGenerateJSON<T>({
    model: modelId,
    prompt: options.prompt,
    systemInstruction: options.systemInstruction,
    temperature: options.temperature,
    maxRetries: options.maxRetries
  })
}

// ============================================================
// 统一 API 封装 - 图片生成
// ============================================================

export interface GenerateImageResult {
  imageData?: string // base64 (Gemini)
  imageUrl?: string // URL (Qwen/Kling/Volcengine)
  mimeType?: string
  text?: string
}

export async function generateImage(options: {
  modelId?: string
  prompt: string
  referenceImage?: { data: string, mimeType: string }
  referenceImages?: string[] // base64 图片数组 (用于 wan2.6-image 等支持多参考图的模型)
  allowTextOnlyResult?: boolean
  negativePrompt?: string
  size?: string
  imageSize?: gemini.GeminiImageSize | string
  aspectRatio?: string
  maxRetries?: number
}): Promise<GenerateImageResult> {
  const modelId = options.modelId || currentModels.image
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] generateImage - provider: ${provider}, model: ${modelId}, refImages: ${options.referenceImages?.length || 0}`)

  if (provider === 'qwen') {
    const result = await qwen._qwenGenerateImage({
      model: modelId,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      size: options.size,
      referenceImages: options.referenceImages,
      maxRetries: options.maxRetries
    })
    return { imageUrl: result.imageUrl }
  }

  if (provider === 'volcengine') {
    const result = await volcengine._volcengineGenerateImage({
      model: modelId,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      size: options.size,
      referenceImages: options.referenceImages,
      maxRetries: options.maxRetries
    })
    return { imageUrl: result.imageUrl }
  }

  if (provider === 'kling') {
    const klingReferenceImages = options.referenceImages && options.referenceImages.length > 0
      ? options.referenceImages
      : options.referenceImage?.data
        ? [options.referenceImage.data]
        : undefined

    const result = await kling._klingGenerateImage({
      model: modelId,
      prompt: options.prompt,
      negativePrompt: options.negativePrompt,
      size: options.size,
      referenceImages: klingReferenceImages,
      maxRetries: options.maxRetries
    })
    return { imageUrl: result.imageUrl }
  }

  // Gemini
  const result = await gemini._geminiGenerateImage({
    model: modelId,
    prompt: options.prompt,
    referenceImage: options.referenceImage,
    referenceImages: options.referenceImages,
    imageSize: options.imageSize,
    aspectRatio: options.aspectRatio,
    size: options.size,
    allowTextOnlyResult: options.allowTextOnlyResult,
    maxRetries: options.maxRetries
  })
  return {
    imageData: result.imageData,
    mimeType: result.mimeType,
    text: result.text
  }
}

// ============================================================
// 统一 API 封装 - 视频生成
// ============================================================

export interface GenerateVideoResult {
  videoData?: string // base64 或 ref (Gemini)
  videoUrl?: string // URL (Qwen/Kling/Volcengine)
  taskId: string
}

export async function generateVideo(options: {
  modelId?: string
  prompt: string
  firstFrame?: string // base64 (Gemini)
  lastFrame?: string // base64 (Gemini)
  firstFrameUrl?: string // 首帧图片 URL (Qwen 首尾帧模型)
  lastFrameUrl?: string // 尾帧图片 URL (Qwen 首尾帧模型)
  imageUrl?: string // 图生视频输入 (Qwen)
  audioUrl?: string // 自定义音频 (Qwen)
  duration?: number
  aspectRatio?: string
  size?: string // Qwen 使用 size 如 '1280*720'
  resolution?: string // 分辨率档位: 480P, 720P, 1080P (Qwen 首尾帧模型)
  negativePrompt?: string
  promptExtend?: boolean
  audio?: boolean
  watermark?: boolean
  seed?: number
  maxRetries?: number
}): Promise<GenerateVideoResult> {
  const modelId = options.modelId || currentModels.video
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] generateVideo - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    const result = await qwen._qwenGenerateVideo({
      model: modelId,
      prompt: options.prompt,
      imageUrl: options.imageUrl,
      firstFrameUrl: options.firstFrameUrl,
      lastFrameUrl: options.lastFrameUrl,
      audioUrl: options.audioUrl,
      duration: options.duration,
      size: options.size,
      resolution: options.resolution,
      negativePrompt: options.negativePrompt,
      promptExtend: options.promptExtend,
      audio: options.audio,
      watermark: options.watermark,
      seed: options.seed,
      maxRetries: options.maxRetries
    })
    return {
      videoUrl: result.videoUrl,
      taskId: result.taskId
    }
  }

  if (provider === 'volcengine') {
    const result = await volcengine._volcengineGenerateVideo({
      model: modelId,
      prompt: options.prompt,
      imageUrl: options.imageUrl,
      firstFrameUrl: options.firstFrameUrl,
      lastFrameUrl: options.lastFrameUrl,
      duration: options.duration,
      size: options.size,
      resolution: options.resolution,
      negativePrompt: options.negativePrompt,
      maxRetries: options.maxRetries
    })
    return {
      videoUrl: result.videoUrl,
      taskId: result.taskId
    }
  }

  if (provider === 'kling') {
    const result = await kling._klingGenerateVideo({
      model: modelId,
      prompt: options.prompt,
      imageUrl: options.imageUrl,
      firstFrameUrl: options.firstFrameUrl,
      lastFrameUrl: options.lastFrameUrl,
      duration: options.duration,
      aspectRatio: options.aspectRatio,
      withAudio: options.audio,
      mode: 'pro',
      negativePrompt: options.negativePrompt,
      maxRetries: options.maxRetries
    })
    return {
      videoUrl: result.videoUrl,
      taskId: result.taskId
    }
  }

  // Gemini - 需要通过原有的 video API 处理
  // 这里返回一个占位，实际视频生成仍通过 /api/video/generate
  throw new Error('Gemini 视频生成请使用 /api/video/generate API')
}

// ============================================================
// 统一 API 封装 - 语音合成
// ============================================================

export async function textToSpeech(options: {
  modelId?: string
  text: string
  voice?: string
  speed?: number
  maxRetries?: number
}): Promise<{ audioData: string, audioUrl?: string }> {
  const modelId = options.modelId || currentModels.tts || qwen.QwenVoiceModels.QWEN3_TTS_FLASH
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] textToSpeech - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenTextToSpeech({
      model: modelId,
      text: options.text,
      voice: options.voice,
      speed: options.speed,
      maxRetries: options.maxRetries
    })
  }

  // Gemini 暂不支持 TTS，使用千问
  return qwen._qwenTextToSpeech({
    model: qwen.QwenVoiceModels.QWEN3_TTS_FLASH,
    text: options.text,
    voice: options.voice,
    speed: options.speed,
    maxRetries: options.maxRetries
  })
}

// ============================================================
// 统一 API 封装 - 语音识别
// ============================================================

export async function speechToText(options: {
  modelId?: string
  audioUrl?: string
  audioData?: string
  language?: string
  maxRetries?: number
}): Promise<{ text: string }> {
  const modelId = options.modelId || currentModels.asr || qwen.QwenVoiceModels.QWEN3_ASR_FLASH
  const provider = getProviderFromModel(modelId)

  const timestamp = new Date().toLocaleTimeString()
  console.log(`[${timestamp}] [ModelProvider] speechToText - provider: ${provider}, model: ${modelId}`)

  if (provider === 'qwen') {
    return qwen._qwenSpeechToText({
      model: modelId,
      audioUrl: options.audioUrl,
      audioData: options.audioData,
      language: options.language,
      maxRetries: options.maxRetries
    })
  }

  // Gemini 暂不支持 ASR，使用千问
  return qwen._qwenSpeechToText({
    model: qwen.QwenVoiceModels.QWEN3_ASR_FLASH,
    audioUrl: options.audioUrl,
    audioData: options.audioData,
    language: options.language,
    maxRetries: options.maxRetries
  })
}
