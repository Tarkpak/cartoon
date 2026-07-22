export type VideoWorkflowAssetStrategy = 'characters' | 'objects' | 'environments' | 'mixed' | 'none'

export interface VideoWorkflowPreset {
  id: string
  name: string
  description: string
  inputLabel: string
  stylePickerMode: 'style_preset' | 'hidden'
  defaultStylePrompt?: string
  planningPromptId: string
  shotVideoPromptId: string
  assetStrategy: VideoWorkflowAssetStrategy
  defaultDurationRange: {
    min: number
    max: number
  }
  requiredShotFields: string[]
}

export const VIDEO_WORKFLOW_PRESETS = [
  {
    id: 'premium_drama',
    name: '精品剧',
    description: '忠实还原原文，按剧情密度自然拆场。',
    inputLabel: '输入小说、剧本或剧情梗概',
    stylePickerMode: 'style_preset',
    planningPromptId: 'script_episode_plan',
    shotVideoPromptId: 'scene_video_generation',
    assetStrategy: 'mixed',
    defaultDurationRange: { min: 2, max: 15 },
    requiredShotFields: ['title', 'duration', 'description', 'characters', 'narration']
  },
  {
    id: 'origin_explainer',
    name: '科普拆解',
    description: '将科学原理、机械结构或工艺过程拆成多镜头解释视频。',
    inputLabel: '输入科学原理、机械结构或工艺过程',
    stylePickerMode: 'hidden',
    defaultStylePrompt: '高精度 3D 科普解释动画，适用于机械结构、工程原理、自然现象、传统工艺与古代智慧解说。根据镜头内容选择宏观场景、剖面透视、结构拆解、微距特写或流程演示。主体外观保持真实可识别，必要时使用局部半透明剖视展示内部结构；只有涉及水流、热量、压力、电流、磁场、应力、气流等不可见或难观察因素时，才使用发光粒子流、流体动力学特效、箭头流线或可视化力线。背景和场景应服务于原理说明：工程类优先使用真实比例环境场景，结构类可使用中性演示空间，传统工艺类可使用克制的历史场景或工坊环境。整体画面清晰克制、结构精密、无字幕无水印',
    planningPromptId: 'origin_explainer_planning',
    shotVideoPromptId: 'origin_explainer_video_generation',
    assetStrategy: 'objects',
    defaultDurationRange: { min: 5, max: 15 },
    requiredShotFields: ['title', 'duration', 'cameraMotion', 'visualPrompt', 'narration']
  }
] as const satisfies ReadonlyArray<VideoWorkflowPreset>

export type VideoWorkflowPresetId = (typeof VIDEO_WORKFLOW_PRESETS)[number]['id']

export function resolveVideoWorkflowPreset(id: string | null | undefined): VideoWorkflowPreset {
  const normalizedId = id === 'short_drama' ? 'premium_drama' : id
  return VIDEO_WORKFLOW_PRESETS.find(item => item.id === normalizedId) || VIDEO_WORKFLOW_PRESETS[0]
}

export function isVideoWorkflowPresetId(id: string): id is VideoWorkflowPresetId {
  return VIDEO_WORKFLOW_PRESETS.some(item => item.id === id)
}
