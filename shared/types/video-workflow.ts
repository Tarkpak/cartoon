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
    id: 'short_drama',
    name: '短剧',
    description: '短剧强节奏结构，优先钩子、暴击与反击预告。',
    inputLabel: '输入小说、剧本或剧情梗概',
    stylePickerMode: 'style_preset',
    planningPromptId: 'script_episode_plan',
    shotVideoPromptId: 'scene_video_generation',
    assetStrategy: 'mixed',
    defaultDurationRange: { min: 2, max: 15 },
    requiredShotFields: ['title', 'duration', 'description', 'characters', 'narration']
  },
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
    defaultStylePrompt: '高精度 3D 科普动画，微距特写、横截面透视与解构拆解图，半透明结晶材质，发光粒子流与高保真流体动力学特效，极简深色石砖平台，中国传统写意远山与云海背景，画面清晰克制、结构精密、无字幕无水印',
    planningPromptId: 'origin_explainer_planning',
    shotVideoPromptId: 'origin_explainer_video_generation',
    assetStrategy: 'objects',
    defaultDurationRange: { min: 5, max: 15 },
    requiredShotFields: ['title', 'duration', 'cameraMotion', 'visualPrompt', 'narration']
  }
] as const satisfies ReadonlyArray<VideoWorkflowPreset>

export type VideoWorkflowPresetId = (typeof VIDEO_WORKFLOW_PRESETS)[number]['id']

export function resolveVideoWorkflowPreset(id: string | null | undefined): VideoWorkflowPreset {
  return VIDEO_WORKFLOW_PRESETS.find(item => item.id === id) || VIDEO_WORKFLOW_PRESETS[0]
}

export function isVideoWorkflowPresetId(id: string): id is VideoWorkflowPresetId {
  return VIDEO_WORKFLOW_PRESETS.some(item => item.id === id)
}
