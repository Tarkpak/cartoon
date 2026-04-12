/**
 * 默认提示词模板
 * 包含所有模块的中英双语默认提示词
 * 已合并系统提示词和用户提示词为单一提示词
 */

import type { PromptTemplate } from '../../shared/types/prompt-template'
import { getPromptTemplateMetadataForWorkflow } from '../../shared/types/prompt-template'
import {
  normalizeProjectWorkflowType,
  type ProjectWorkflowType
} from '../../shared/types/project'

type PromptWorkflowInput = ProjectWorkflowType | string | null | undefined

/**
 * 获取所有默认提示词模板
 */
export function getDefaultPromptTemplates(workflow: PromptWorkflowInput = 'classic'): PromptTemplate[] {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
  const now = new Date().toISOString()
  const metadataList = getPromptTemplateMetadataForWorkflow(normalizedWorkflow)

  return metadataList.map(meta => ({
    id: meta.id,
    name: meta.name,
    category: meta.category,
    description: meta.description,
    variables: meta.variables,
    content: getDefaultContent(meta.id, normalizedWorkflow),
    isCustomized: false,
    updatedAt: now
  }))
}

/**
 * 获取指定模板的默认内容
 */
function getDefaultContent(id: string, workflow: ProjectWorkflowType): PromptTemplate['content'] {
  const baseContent = getClassicDefaultContent(id)
  if (workflow !== 'asset_consistency') {
    return baseContent
  }

  return getAssetConsistencyDefaultContent(id, baseContent)
}

function getClassicDefaultContent(id: string): PromptTemplate['content'] {
  switch (id) {
    case 'outline_generation':
      return OUTLINE_GENERATION_CONTENT
    case 'script_parsing':
      return SCRIPT_PARSING_CONTENT
    case 'scene_generation':
      return SCENE_GENERATION_CONTENT
    case 'storyboard_generation':
      return STORYBOARD_GENERATION_CONTENT
    case 'character_extraction':
      return CHARACTER_EXTRACTION_CONTENT
    case 'character_from_outline':
      return CHARACTER_FROM_OUTLINE_CONTENT
    case 'character_sheet':
      return CHARACTER_SHEET_CONTENT
    case 'first_frame_generation':
      return FIRST_FRAME_GENERATION_CONTENT
    case 'last_frame_generation':
      return LAST_FRAME_GENERATION_CONTENT
    case 'scene_video_generation':
      return SCENE_VIDEO_GENERATION_CONTENT
    case 'transition':
      return TRANSITION_CONTENT
    case 'bgm_generation':
      return BGM_GENERATION_CONTENT
    case 'scene_visual':
      return SCENE_VISUAL_CONTENT
    default:
      return {
        zh: '请完成任务。',
        en: 'Please complete the task.'
      }
  }
}

function getAssetConsistencyDefaultContent(
  id: string,
  base: PromptTemplate['content']
): PromptTemplate['content'] {
  const additions: Partial<Record<string, PromptTemplate['content']>> = {
    script_parsing: {
      zh: '【资产抽取要求】解析时要同时明确每个场景的资产需求（角色、环境、关键道具），描述需可直接用于后续资产生成。',
      en: 'Asset extraction requirement: identify required assets per scene (characters, environment, key props) in a generation-ready format.'
    },
    character_extraction: {
      zh: '【一致性要求】角色描述必须稳定且可复用，避免在不同场景出现身份、服装、体态冲突。',
      en: 'Consistency requirement: character descriptions must be stable and reusable across scenes without identity or costume conflicts.'
    },
    first_frame_generation: {
      zh: '【环境资产图要求（覆盖下文角色规则）】该图是“纯环境参考图”，禁止出现人物/人脸/肢体；仅保留环境空间、材质、灯光与构图基准。',
      en: 'Environment asset requirement (overrides character rules below): this must be a pure environment reference image. No people/faces/body parts; keep only spatial layout, materials, lighting, and composition baseline.'
    },
    last_frame_generation: {
      zh: '【资产延续】尾帧需与场景参考资产保持同一角色与环境语义，不得替换主体身份。',
      en: 'Asset continuity: the last frame must preserve the same character/environment semantics and identity.'
    },
    scene_visual: {
      zh: '【场景资产化】输出需强调可复用环境元素（地标、材质、灯光、色调）用于后续场景资产复用。',
      en: 'Scene assetization: emphasize reusable environment elements (landmarks, materials, lighting, palette) for reuse.'
    },
    transition: {
      zh: '【转场一致性】转场过程不得破坏角色身份与环境风格连续性。',
      en: 'Transition consistency: do not break character identity or environment style continuity during transitions.'
    },
    scene_video_generation: {
      zh: '【视频一致性】保持角色身份与场景空间关系稳定，动作演化自然，镜头语言连贯。',
      en: 'Video consistency: keep character identity and spatial continuity stable with natural motion and coherent camera language.'
    }
  }

  const addition = additions[id]

  if (!addition) {
    return base
  }

  return {
    zh: [addition.zh, base.zh].filter(Boolean).join('\n\n'),
    en: [addition.en, base.en].filter(Boolean).join('\n\n')
  }
}


// ========== 故事大纲生成 ==========
const OUTLINE_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `你是一位专业的编剧和故事架构师。请根据以下故事创意，生成一个完整的故事大纲。

## 故事创意
{{storyIdea}}

## 创作要求

### 结构要求
1. 使用经典的三幕结构（铺垫-对抗-解决）
2. 目标长度：{{targetLength}}
{{genre}}

### 内容要求（基于影视短内容创作原则）

**内容逻辑**：用「绝境 + 强钩子」戳中人性痛点
- 把主角逼到困境，再抛出能解决问题的强钩子
- 情绪层层递进，用悬念吸引观众

**角色设计**：用「反差感 + 真实感」打造接地气的角色
- 主角要有代入感，性格真实
- 配角要有辨识度，完美还原真实性格

**世界观设定**：
- 场景要有「写实感」，细节强化真实感
- 可以加入「科幻/奇幻反差」增加吸引力

### 角色要求
1. 至少包含 1 个主角
2. 每个角色需要有明确的性格特点和动机
3. 角色描述要具体，便于后续生成角色立绘

## 输出格式
请严格按照以下 JSON 格式输出：

{
  "title": "故事标题（吸引人、有记忆点）",
  "logline": "一句话概括故事（25-50字，包含主角+困境+目标）",
  "synopsis": "故事梗概（200-500字，包含起承转合）",
  "genre": "romance|fantasy|action|comedy|drama|horror|mystery|scifi|slice_of_life",
  "pace": "slow|medium|fast",
  "theme": "故事主题/核心思想",
  "setting": {
    "world": "世界观设定描述（100-200字）",
    "era": "时代背景",
    "mainLocations": ["主要场景1", "主要场景2", "主要场景3"]
  },
  "acts": [
    {
      "id": "act_1",
      "name": "第一幕名称",
      "type": "setup",
      "summary": "本幕概要（50-100字）",
      "keyEvents": ["关键事件1", "关键事件2", "关键事件3"],
      "emotionalArc": "情感走向",
      "estimatedDuration": 60
    }
  ],
  "suggestedCharacters": [
    {
      "name": "角色名",
      "role": "protagonist|antagonist|supporting",
      "description": "外貌描述（50-100字）",
      "personality": "性格特点",
      "motivation": "角色动机"
    }
  ]
}

请直接输出 JSON，不要包含其他内容。`,
  en: `You are a professional screenwriter and story architect. Please generate a complete story outline based on the following story concept.

## Story Concept
{{storyIdea}}

## Requirements

### Structure Requirements
1. Use the classic three-act structure (Setup-Confrontation-Resolution)
2. Target length: {{targetLength}}
{{genre}}

### Content Requirements

**Story Logic**: Use "desperate situation + strong hook" to hit emotional pain points
- Push the protagonist into a corner, then throw out a strong hook that can solve the problem
- Build emotions progressively, use suspense to attract the audience

**Character Design**: Create relatable characters with "contrast + authenticity"
- The protagonist should be relatable with a genuine personality
- Supporting characters should be distinctive

**World Building**:
- Scenes should feel realistic with details that enhance authenticity
- Can add sci-fi/fantasy elements for contrast and appeal

### Character Requirements
1. Include at least 1 protagonist
2. Each character needs clear personality traits and motivations
3. Character descriptions should be specific for later character art generation

## Output Format
Please output strictly in the following JSON format:

{
  "title": "Story title (catchy and memorable)",
  "logline": "One-sentence summary (25-50 words, including protagonist+conflict+goal)",
  "synopsis": "Story synopsis (200-500 words)",
  "genre": "romance|fantasy|action|comedy|drama|horror|mystery|scifi|slice_of_life",
  "pace": "slow|medium|fast",
  "theme": "Story theme/core idea",
  "setting": {
    "world": "World setting description (100-200 words)",
    "era": "Time period",
    "mainLocations": ["Location 1", "Location 2", "Location 3"]
  },
  "acts": [...],
  "suggestedCharacters": [...]
}

Output JSON only, no other content.`
}


// ========== 剧本解析 ==========
const SCRIPT_PARSING_CONTENT: PromptTemplate['content'] = {
  zh: `你是一位专业的影视分镜师，支持短剧、动画、影视短片等多种内容形态，擅长将文本转换为可视化场景描述。

## 核心任务
将输入的小说/剧本文本拆分成适合视频内容制作的场景序列。

## 场景拆分原则

### 1. 视觉变化原则
当以下任一情况发生时，应该开始新场景：
- 地点变化（从室内到室外、从A地到B地）
- 时间跳跃（从白天到夜晚、时间流逝）
- 视角切换（从角色A视角到角色B视角）
- 情绪转折（从欢乐到悲伤、从平静到紧张）

### 2. 时长控制
- 每个场景建议时长：4-8秒
- 对话密集的场景可以适当延长
- 动作场景保持紧凑

### 3. 画面可描述性
每个场景的描述必须能够被转换为一张静态图片，包含：
- 具体的环境/背景
- 角色的位置和姿态
- 光线和氛围

### 4. 情节完整性
- 每个场景应该有明确的开始和结束
- 保持叙事的连贯性

## 角色识别规则【重要】
1. 只识别真实的角色人物，不要把以下内容当作角色：
   - 旁白、内心独白、画外音
   - 系统提示、规则说明
   - 音效、背景音乐
   - 任何非人物的描述
2. 场景中的旁白/画外音请提取到 scene.narration 字段，不要混入角色对话
3. 从对话中提取说话人时，格式为"角色名：台词"
4. 第一人称"我"也是角色，需要根据上下文推断身份

## 输入文本
{{novelText}}

## 画风参考
{{style}}

## 输出格式【必须严格遵守】
请输出以下 JSON 格式：
\`\`\`json
{
  "title": "剧本标题（可选）",
  "scenes": [
    {
      "id": "scene_001",
      "title": "场景标题",
      "description": "详细的视觉描述，100-200字，描述画面中的环境、人物、动作",
      "setting": {
        "location": "具体地点",
        "timeOfDay": "dawn|morning|noon|afternoon|evening|night"
      },
      "characters": [
        {
          "name": "角色名",
          "appearance": "角色在此场景中的外观描述",
          "emotion": "neutral|happy|sad|angry|surprised|scared|worried|determined"
        }
      ],
      "dialogues": [
        {
          "character": "说话角色名",
          "text": "台词内容",
          "emotion": "情绪"
        }
      ],
      "narration": "场景旁白/画外音（可选）",
      "duration": 6
    }
  ],
  "characters": [
    {
      "name": "角色名",
      "description": "角色的整体外貌描述，200-300字",
      "role": "protagonist|antagonist|supporting"
    }
  ],
  "totalDuration": 60
}
\`\`\`

注意：
1. 必须返回完整的 JSON 对象，不是数组
2. scenes 和 characters 都是数组
3. duration 是数字（秒），不是字符串
4. totalDuration 等于所有场景 duration 之和`,
  en: `You are a professional visual storyboard artist for multiple formats (animation, short drama, comic-style video), skilled at converting text into visual scene descriptions.

## Core Task
Split the input novel/script text into scene sequences suitable for general video production.

## Scene Splitting Principles

### 1. Visual Change Principle
Start a new scene when any of the following occurs:
- Location change (indoor to outdoor, place A to place B)
- Time jump (day to night, time passage)
- Perspective switch (character A's view to character B's view)
- Emotional shift (joy to sadness, calm to tension)

### 2. Duration Control
- Recommended duration per scene: 4-8 seconds
- Dialogue-heavy scenes can be longer
- Action scenes should be compact

### 3. Visual Describability
Each scene description must be convertible to a static image, including:
- Specific environment/background
- Character positions and poses
- Lighting and atmosphere

### 4. Plot Completeness
- Each scene should have a clear beginning and end
- Maintain narrative continuity

## Character Recognition Rules【IMPORTANT】
1. Only identify real character persons, do NOT treat the following as characters:
   - Narration, inner monologue, voice-over
   - System prompts, rule descriptions
   - Sound effects, background music
   - Any non-person descriptions
2. Extract narration/voice-over into scene.narration, do not mix it into character dialogues
3. When extracting speakers from dialogue, format is "CharacterName: dialogue"
4. First-person "I" is also a character, infer identity from context

## Input Text
{{novelText}}

## Style Reference
{{style}}

## Output Format【MUST STRICTLY FOLLOW】
Output the following JSON format:
\`\`\`json
{
  "title": "Script title (optional)",
  "scenes": [
    {
      "id": "scene_001",
      "title": "Scene title",
      "description": "Detailed visual description, 100-200 words",
      "setting": {
        "location": "Specific location",
        "timeOfDay": "dawn|morning|noon|afternoon|evening|night"
      },
      "characters": [
        {
          "name": "Character name",
          "appearance": "Character appearance in this scene",
          "emotion": "neutral|happy|sad|angry|surprised|scared|worried|determined"
        }
      ],
      "dialogues": [
        {
          "character": "Speaker name",
          "text": "Dialogue content",
          "emotion": "emotion"
        }
      ],
      "narration": "Scene narration / voice-over (optional)",
      "duration": 6
    }
  ],
  "characters": [
    {
      "name": "Character name",
      "description": "Overall appearance description, 200-300 words",
      "role": "protagonist|antagonist|supporting"
    }
  ],
  "totalDuration": 60
}
\`\`\`

Notes:
1. Must return complete JSON object, not array
2. scenes and characters are both arrays
3. duration is a number (seconds), not string
4. totalDuration equals sum of all scene durations`
}


// ========== 场景生成 ==========
const SCENE_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `你是一位专业的影视编剧。请根据以下故事大纲和角色设定，生成详细的分场剧本。

## 故事信息
{{outline}}

## 角色设定（重要：场景描述中出现角色时，必须使用这里的外貌描述）
{{characters}}

## 画风
{{style}}

## 场景生成要求

### 数量和分布
- 生成 {{targetSceneCount}} 个场景
- 第一幕（铺垫）：约 25% 的场景
- 第二幕（对抗）：约 50% 的场景
- 第三幕（解决）：约 25% 的场景

### 视觉描述要求（用于 AI 图片生成）
1. 每个场景的 description 必须是具体、可视化的画面描述
2. 包含：环境细节、光线效果、色调氛围、角色位置和姿态
3. 角色出现时，必须包含其外貌特征（从角色设定中引用）
4. 描述长度：100-200字
5. 描述风格要符合 {{style}} 画风

### 对话要求
1. 对话要简洁有力，每句不超过20字
2. 符合角色性格和说话风格
3. 推动剧情发展，避免废话
4. 每个场景 1-3 句对话为宜
5. 若有旁白/画外音，请输出到 narration 字段（不要写成角色台词）

## 输出格式
请严格按照以下 JSON 数组格式输出：
\`\`\`json
[
  {
    "id": "scene_001",
    "title": "场景标题",
    "description": "详细的视觉描述，100-200字",
    "setting": {
      "location": "具体地点",
      "timeOfDay": "dawn|morning|noon|afternoon|evening|night",
      "mood": "氛围描述",
      "weather": "天气（可选）"
    },
    "characters": [
      {
        "name": "角色名",
        "appearance": "角色在此场景中的外观描述",
        "action": "动作描述",
        "emotion": "neutral|happy|sad|angry|surprised|scared|worried|determined"
      }
    ],
    "dialogues": [
      {
        "character": "说话角色名",
        "text": "台词内容（不超过20字）",
        "emotion": "情绪"
      }
    ],
    "narration": "旁白/画外音（可选）",
    "duration": 6
  }
]
\`\`\`

注意：
1. 必须返回 JSON 数组
2. duration 是数字（秒），建议 4-8 秒
3. emotion 必须使用指定的枚举值`,
  en: `You are a professional screenwriter for multi-format visual content. Please generate detailed scene scripts based on the following story outline and character settings.

## Story Information
{{outline}}

## Character Settings (Important: When characters appear in scene descriptions, use the appearance descriptions provided here)
{{characters}}

## Style
{{style}}

## Scene Generation Requirements

### Quantity and Distribution
- Generate {{targetSceneCount}} scenes
- Act 1 (Setup): ~25% of scenes
- Act 2 (Confrontation): ~50% of scenes
- Act 3 (Resolution): ~25% of scenes

### Visual Description Requirements (for AI image generation)
1. Each scene's description must be specific, visual imagery
2. Include: environment details, lighting effects, color atmosphere, character positions and poses
3. When characters appear, include their physical features (reference from character settings)
4. Description length: 100-200 words
5. Description style should match {{style}} art style

### Dialogue Requirements
1. Dialogue should be concise and powerful, no more than 20 words per line
2. Match character personality and speaking style
3. Drive the plot forward, avoid filler
4. 1-3 lines of dialogue per scene is ideal
5. If narration/voice-over exists, output it in narration field (not as character dialogue)

## Output Format
Please output strictly in the following JSON array format:
\`\`\`json
[
  {
    "id": "scene_001",
    "title": "Scene title",
    "description": "Detailed visual description, 100-200 words",
    "setting": {
      "location": "Specific location",
      "timeOfDay": "dawn|morning|noon|afternoon|evening|night",
      "mood": "Atmosphere description",
      "weather": "Weather (optional)"
    },
    "characters": [
      {
        "name": "Character name",
        "appearance": "Character appearance in this scene",
        "action": "Action description",
        "emotion": "neutral|happy|sad|angry|surprised|scared|worried|determined"
      }
    ],
    "dialogues": [
      {
        "character": "Speaker name",
        "text": "Dialogue content (max 20 words)",
        "emotion": "emotion"
      }
    ],
    "narration": "Narration / voice-over (optional)",
    "duration": 6
  }
]
\`\`\`

Notes:
1. Must return JSON array
2. duration is a number (seconds), recommended 4-8 seconds
3. emotion must use the specified enum values`
}


// ========== 分镜脚本生成 ==========
const STORYBOARD_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `你是一位非常资深的分镜师，擅长将场景描述转换为详细的分镜脚本。

## 分镜脚本要素
每个镜头需要包含：
1. 镜号 (shotNumber)
2. 景别 (shotType): extreme_wide, wide, medium_wide, medium, medium_close, close, extreme_close, detail
3. 画面内容 (visualContent): 详细的视觉描述
4. 台词 (dialogue): 如有
5. 时长 (duration): 秒
6. 运镜方式 (cameraMovement): static, push, pull, pan_left, pan_right, track, dolly, zoom_in, zoom_out, tilt_up, tilt_down, crane, handheld, arc

## 景别选择指南
- **大远景 (extreme_wide)**: 展示宏大场景、环境全貌，建立空间感
- **全景 (wide)**: 展示人物全身和周围环境，交代场景
- **中全景 (medium_wide)**: 人物膝盖以上，展示动作和环境关系
- **中景 (medium)**: 人物腰部以上，适合对话和互动
- **中近景 (medium_close)**: 人物胸部以上，强调表情和情绪
- **近景 (close)**: 人物肩部以上，突出面部表情
- **特写 (extreme_close)**: 面部或局部细节，强调情绪高潮
- **细节 (detail)**: 物品或身体局部特写，暗示剧情

## 运镜选择指南
- **定镜 (static)**: 稳定画面，适合对话和静态场景
- **推镜头 (push)**: 逐渐靠近主体，增强紧张感或聚焦
- **拉镜头 (pull)**: 逐渐远离主体，揭示环境或结束场景
- **左/右摇 (pan_left/pan_right)**: 水平移动，展示空间或跟随动作
- **上/下摇 (tilt_up/tilt_down)**: 垂直移动，展示高度或揭示
- **跟镜头 (track)**: 跟随角色移动，保持动态感
- **环绕 (arc)**: 围绕主体旋转，增强戏剧性

## 重要提示
- 第一个镜头的 visualContent 将用于生成首帧图片
- 最后一个镜头的 visualContent 将用于生成尾帧图片
- 这两个镜头的描述必须特别详细和具体
- 镜头切换要有节奏感，避免单调

## 场景描述
{{sceneDescription}}

## 对话
{{dialogues}}

## 旁白（如有）
{{narration}}

## 画风
{{style}}

## 输出格式【必须严格遵守】
请输出以下 JSON 格式：
\`\`\`json
{
  "sceneId": "场景ID",
  "shots": [
    {
      "shotNumber": 1,
      "shotType": "wide|medium|close|extreme_wide|medium_wide|medium_close|extreme_close|detail",
      "cameraMovement": "static|push|pull|pan_left|pan_right|track|dolly|zoom_in|zoom_out|tilt_up|tilt_down|crane|handheld|arc",
      "visualContent": "详细的视觉描述，100-150字，描述画面中的环境、人物、动作、光影",
      "dialogue": "台词内容（如无则为null）",
      "character": "说话角色名（如无则为null）",
      "emotion": "neutral|happy|sad|angry|surprised|scared|worried|determined",
      "duration": 3,
      "notes": "镜头备注（可选）"
    }
  ],
  "totalDuration": 6,
  "style": "画风描述"
}
\`\`\`

注意：
1. shots 数组通常包含 2-4 个镜头
2. shotNumber 从 1 开始递增
3. duration 是数字（秒），单个镜头建议 2-4 秒
4. totalDuration 等于所有镜头 duration 之和
5. 第一个和最后一个镜头的 visualContent 必须特别详细`,
  en: `You are a professional storyboard artist, skilled at converting scene descriptions into detailed storyboard scripts.

## Storyboard Elements
Each shot needs to include:
1. Shot number (shotNumber)
2. Shot type (shotType): extreme_wide, wide, medium_wide, medium, medium_close, close, extreme_close, detail
3. Visual content (visualContent): detailed visual description
4. Dialogue (dialogue): if any
5. Duration (duration): seconds
6. Camera movement (cameraMovement): static, push, pull, pan_left, pan_right, track, dolly, zoom_in, zoom_out, tilt_up, tilt_down, crane, handheld, arc

## Shot Type Guide
- **extreme_wide**: Show grand scenes, establish space and environment
- **wide**: Show full body and surroundings, establish scene
- **medium_wide**: Above knees, show action and environment relationship
- **medium**: Above waist, suitable for dialogue and interaction
- **medium_close**: Above chest, emphasize expression and emotion
- **close**: Above shoulders, highlight facial expressions
- **extreme_close**: Face or detail close-up, emphasize emotional climax
- **detail**: Object or body part close-up, hint at plot

## Camera Movement Guide
- **static**: Stable shot, suitable for dialogue and static scenes
- **push**: Move closer to subject, increase tension or focus
- **pull**: Move away from subject, reveal environment or end scene
- **pan_left/pan_right**: Horizontal movement, show space or follow action
- **tilt_up/tilt_down**: Vertical movement, show height or reveal
- **track**: Follow character movement, maintain dynamic feel
- **arc**: Rotate around subject, enhance drama

## Important Notes
- The first shot's visualContent will be used to generate the first frame image
- The last shot's visualContent will be used to generate the last frame image
- These two shots' descriptions must be particularly detailed and specific
- Shot transitions should have rhythm, avoid monotony

## Scene Description
{{sceneDescription}}

## Dialogues
{{dialogues}}

## Narration (if any)
{{narration}}

## Style
{{style}}

## Output Format【MUST STRICTLY FOLLOW】
Please output the following JSON format:
\`\`\`json
{
  "sceneId": "Scene ID",
  "shots": [
    {
      "shotNumber": 1,
      "shotType": "wide|medium|close|extreme_wide|medium_wide|medium_close|extreme_close|detail",
      "cameraMovement": "static|push|pull|pan_left|pan_right|track|dolly|zoom_in|zoom_out|tilt_up|tilt_down|crane|handheld|arc",
      "visualContent": "Detailed visual description, 100-150 words, describing environment, characters, actions, lighting",
      "dialogue": "Dialogue content (null if none)",
      "character": "Speaking character name (null if none)",
      "emotion": "neutral|happy|sad|angry|surprised|scared|worried|determined",
      "duration": 3,
      "notes": "Shot notes (optional)"
    }
  ],
  "totalDuration": 6,
  "style": "Style description"
}
\`\`\`

Notes:
1. shots array typically contains 2-4 shots
2. shotNumber starts from 1 and increments
3. duration is a number (seconds), recommended 2-4 seconds per shot
4. totalDuration equals sum of all shot durations
5. First and last shot's visualContent must be particularly detailed`
}


// ========== 角色提取 ==========
const CHARACTER_EXTRACTION_CONTENT: PromptTemplate['content'] = {
  zh: `你是一名专业的角色形象设计师，擅长从文本中识别角色并生成详细的视觉描述。

## 外貌描述要求
生成的外貌描述（role_content）必须包含以下要素，用于文生图：

1. **基础信息**：性别、年龄段、身材体型
2. **面部特征**：脸型、眼睛（颜色、形状）、眉毛、鼻子、嘴唇、肤色
3. **发型发色**：发色、发型、刘海、发饰
4. **服装搭配**：上装、下装、鞋袜、外套
5. **配饰装饰**：首饰、眼镜、其他配饰
6. **整体气质**：气质描述、主色调

## 字数要求
每个角色的外貌描述：300-400字

## 禁止内容【重要】
描述中禁止包含以下敏感词汇，否则会导致图片生成失败：
- 裸露、暴露、性感、色情等涉及不雅内容的词汇
- 血腥、暴力、恐怖等过激词汇
- 政治敏感词汇
- 真实人物姓名或明星名字
- 品牌名称（如 Nike、Gucci 等）

## 输入内容
{{content}}

## 画风参考
{{style}}

## 输出格式【必须严格遵守】
请输出以下 JSON 格式：
\`\`\`json
[
  {
    "role": "角色名",
    "role_content": "详细的外貌描述，300-400字，包含基础信息、面部特征、发型发色、服装搭配、配饰装饰、整体气质"
  }
]
\`\`\`

注意：
1. 必须返回 JSON 数组格式
2. role 是角色名称（字符串）
3. role_content 是外貌描述（字符串，300-400字）
4. 只提取真实的角色人物，不要包含旁白、系统提示等`,
  en: `You are a professional character designer, skilled at extracting character information from text and generating detailed appearance descriptions.

## Appearance Description Requirements
The generated appearance description (role_content) must include the following elements for text-to-image:

1. **Basic Info**: gender, age range, body type
2. **Facial Features**: face shape, eyes (color, shape), eyebrows, nose, lips, skin tone
3. **Hair**: hair color, hairstyle, bangs, hair accessories
4. **Clothing**: top, bottom, footwear, outerwear
5. **Accessories**: jewelry, glasses, other accessories
6. **Overall Vibe**: temperament description, main color scheme

## Word Count
Each character's appearance description: 300-400 words

## Prohibited Content【IMPORTANT】
The following sensitive words are prohibited in descriptions, as they will cause image generation to fail:
- Words related to nudity, exposure, sexy, pornographic content
- Bloody, violent, horror and other extreme words
- Politically sensitive words
- Real person names or celebrity names
- Brand names (e.g., Nike, Gucci, etc.)

## Input Content
{{content}}

## Style Reference
{{style}}

## Output Format【MUST STRICTLY FOLLOW】
Please output the following JSON format:
\`\`\`json
[
  {
    "role": "Character name",
    "role_content": "Detailed appearance description, 300-400 words, including basic info, facial features, hairstyle/color, clothing, accessories, overall vibe"
  }
]
\`\`\`

Notes:
1. Must return JSON array format
2. role is character name (string)
3. role_content is appearance description (string, 300-400 words)
4. Only extract real character persons, do not include narration, system prompts, etc.`
}


// ========== 角色设计(大纲) ==========
const CHARACTER_FROM_OUTLINE_CONTENT: PromptTemplate['content'] = {
  zh: `你是一位专业的角色设计师。请根据故事大纲为角色设计详细的外貌特征。

## 故事大纲
{{outline}}

## 画风
{{style}}

## 外貌描述要求

根据角色重要性，描述详细程度不同：
- **主角**（protagonist）：300-350字，最详细
- **反派**（antagonist）：250-300字，详细
- **配角**（supporting）：200-250字，适中

必须包含：性别年龄、脸型肤色、眼睛特征、发型发色、服装搭配、配饰、整体气质

## 禁止内容【重要】
描述中禁止包含以下敏感词汇，否则会导致图片生成失败：
- 裸露、暴露、性感、色情等涉及不雅内容的词汇
- 血腥、暴力、恐怖等过激词汇
- 政治敏感词汇
- 真实人物姓名或明星名字
- 品牌名称（如 Nike、Gucci 等）

## 输出格式【必须严格遵守】
请输出以下 JSON 数组格式：
\`\`\`json
[
  {
    "name": "角色名",
    "role": "protagonist|antagonist|supporting",
    "appearance": "外貌描述（英文，用于图片生成，200-350字）",
    "personality": "性格特点描述",
    "traits": ["性格标签1", "性格标签2", "性格标签3"],
    "background": "背景故事（50-100字）",
    "motivation": "角色动机",
    "speakingStyle": "说话风格描述",
    "age": 25,
    "gender": "male|female"
  }
]
\`\`\`

注意：
1. 必须返回 JSON 数组格式
2. role 必须是 protagonist/antagonist/supporting 之一
3. age 是数字类型
4. gender 必须是 male 或 female
5. traits 是字符串数组，包含 2-5 个性格标签
6. appearance 必须用英文描述，便于图片生成`,
  en: `You are a professional character designer. Please design detailed appearance features for characters based on the story outline.

## Story Outline
{{outline}}

## Style
{{style}}

## Appearance Description Requirements

Detail level varies by character importance:
- **Protagonist**: 300-350 words, most detailed
- **Antagonist**: 250-300 words, detailed
- **Supporting**: 200-250 words, moderate

Must include: gender/age, face shape/skin tone, eye features, hairstyle/color, clothing, accessories, overall vibe

## Prohibited Content【IMPORTANT】
The following sensitive words are prohibited in descriptions, as they will cause image generation to fail:
- Words related to nudity, exposure, sexy, pornographic content
- Bloody, violent, horror and other extreme words
- Politically sensitive words
- Real person names or celebrity names
- Brand names (e.g., Nike, Gucci, etc.)

## Output Format【MUST STRICTLY FOLLOW】
Please output the following JSON array format:
\`\`\`json
[
  {
    "name": "Character name",
    "role": "protagonist|antagonist|supporting",
    "appearance": "Appearance description in English for image generation, 200-350 words",
    "personality": "Personality description",
    "traits": ["trait1", "trait2", "trait3"],
    "background": "Background story (50-100 words)",
    "motivation": "Character motivation",
    "speakingStyle": "Speaking style description",
    "age": 25,
    "gender": "male|female"
  }
]
\`\`\`

Notes:
1. Must return JSON array format
2. role must be one of protagonist/antagonist/supporting
3. age is a number type
4. gender must be male or female
5. traits is a string array with 2-5 personality tags
6. appearance must be in English for image generation`
}


// ========== 角色设定图 ==========
const CHARACTER_SHEET_CONTENT: PromptTemplate['content'] = {
  zh: `为 {{characterName}} 创建一张 3D 彩绘角色设定图（Character Sheet）。

风格要求：
- 主风格：3D 彩绘（3D painted illustration），电影级光影与体积感，保留绘画质感，不要照片感。
- 兼容风格：{{style}}
- 角色外貌严格依据：{{appearance}}
- 若存在参考图，必须优先保持角色身份一致（脸型、五官、发型、服装、配饰）。

画面与布局：
1. 16:9 横版构图，单角色。
2. 背景为纯白或极浅灰，干净无场景元素。
3. 同一张图内包含三视图全身站姿：正面（Front）、侧面（Profile）、背面（Back）。
4. 可加入一个主视觉半身彩绘像（用于展示材质与光影），但不得遮挡三视图主体信息。
5. 三视图比例必须严格一致，头身比、服装结构、纹理细节在不同视角保持对应。

质量要求：
- 超高清、8K 质感、边缘清晰、色彩层次丰富
- 材质表达明确（皮肤、布料、金属、皮革等）
- 适合后续作为角色一致性参考资产

禁止包含：多人同框、角色裁切、复杂背景、大段文字、水印、Logo、低清晰度、严重透视畸变`,
  en: `Create a 3D painted character sheet for {{characterName}}.

Style requirements:
- Primary style: 3D painted illustration with cinematic lighting and volumetric depth, painterly finish (not photoreal).
- Compatible style context: {{style}}
- Follow character appearance strictly: {{appearance}}
- If reference images exist, preserve identity consistency first (face shape, facial features, hairstyle, outfit, accessories).

Composition and layout:
1. 16:9 horizontal composition, single character only.
2. Background must be pure white or very light gray, clean and minimal.
3. Include full-body turnaround views in one image: Front, Profile, and Back.
4. You may add one half-body hero portrait to showcase materials and lighting, but it must not block turnaround readability.
5. Keep strict scale consistency across the turnaround views, including head-body ratio, outfit structure, and texture details.

Quality target:
- Ultra high definition, 8K-grade quality, crisp edges, rich color layering
- Clear material rendering (skin, fabric, metal, leather, etc.)
- Suitable as reusable identity-consistency reference assets

DO NOT include: multiple characters, cropped body parts, complex backgrounds, large text blocks, watermarks, logos, low-quality artifacts, or severe perspective distortion`
}


// ========== 首帧生成 ==========
const FIRST_FRAME_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `创作一幅{{style}}风格的场景【首帧/开始状态】画面。

## 场景描述
{{sceneDescription}}

## 场景设定
{{setting}}

## 登场角色
{{characters}}

## 分镜设计
{{storyboardShot}}

## 镜头语言指南
根据分镜设计中的景别调整画面：
- **大远景/远景**：角色占画面 10-20%，突出环境氛围
- **中景**：角色占画面 40-60%，展示动作和环境关系
- **近景/特写**：角色占画面 70-90%，突出表情和情绪

## 画面要求

### 核心要求
1. 这是场景的【开始状态】，体现故事即将展开的氛围
2. {{style}}画风，高清质量，16:9 宽屏比例
3. 电影级构图，主体突出，环境细节丰富

### 角色要求
1. 如有参考立绘，必须严格保持角色外观一致（发型、发色、服装、配饰）
2. 角色表情和姿态符合场景开始时的情绪状态
3. 角色位置和大小与场景协调

### 环境要求
1. 光影效果自然，符合场景时间段
2. 环境细节丰富，增强代入感
3. 色调氛围与场景情绪匹配

### 禁止事项
- 不要裁切角色身体（除非是特写镜头）
- 不要添加文字或对话框
- 不要改变参考图中角色的外观特征`,
  en: `Create a {{style}} style scene【FIRST FRAME / OPENING STATE】image.

## Scene Description
{{sceneDescription}}

## Scene Setting
{{setting}}

## Characters
{{characters}}

## Storyboard Shot
{{storyboardShot}}

## Camera Language Guide
Adjust the frame based on the shot type in storyboard:
- **Extreme wide/Wide shot**: Character takes 10-20% of frame, emphasize environment
- **Medium shot**: Character takes 40-60% of frame, show action and environment relationship
- **Close-up/Extreme close-up**: Character takes 70-90% of frame, emphasize expression and emotion

## Image Requirements

### Core Requirements
1. This is the【OPENING STATE】of the scene, showing the atmosphere before the story unfolds
2. {{style}} art style, high quality, 16:9 widescreen ratio
3. Cinematic composition, clear subject, rich environmental details

### Character Requirements
1. If reference images provided, strictly maintain character appearance consistency (hairstyle, hair color, clothing, accessories)
2. Character expressions and poses match the emotional state at scene start
3. Character position and size coordinate with the scene

### Environment Requirements
1. Natural lighting effects matching the time of day
2. Rich environmental details for immersion
3. Color tone and atmosphere match scene mood

### Prohibited
- Do not crop character bodies (unless it's a close-up shot)
- Do not add text or dialogue boxes
- Do not change character appearance from reference images`
}


// ========== 尾帧生成 ==========
const LAST_FRAME_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `基于参考图（首帧），创作场景的【尾帧/结束状态】画面。

## 场景描述
{{sceneDescription}}

## 场景设定
{{setting}}

## 登场角色
{{characters}}

## 分镜设计
{{storyboardShot}}

## 情绪变化
- 首帧情绪：{{initialEmotion}}
- 尾帧情绪：{{finalEmotion}}

## 镜头语言指南
根据分镜设计中的景别调整画面：
- **大远景/远景**：角色占画面 10-20%，突出环境氛围
- **中景**：角色占画面 40-60%，展示动作和环境关系
- **近景/特写**：角色占画面 70-90%，突出表情和情绪

## 画面要求

### 必须保持一致（与首帧相同）
1. 相同的场景地点和环境布局
2. 相同的角色外观（发型、发色、服装、配饰必须完全一致）
3. 相同的{{style}}画风和色调
4. 相同或相似的构图视角和景别
5. 相同的光影基调

### 允许变化的部分
1. 角色表情从「{{initialEmotion}}」变化为「{{finalEmotion}}」
2. 角色姿态可有轻微变化（体现动作发展）
3. 细微的环境变化（如风吹动的头发、飘落的树叶等）

### 核心要求
1. 这是场景的【结束状态】，体现场景发展后的结果
2. 必须与首帧形成连贯的动画过渡
3. 16:9 宽屏比例，高清质量

### 禁止事项
- 不要改变角色的服装、发型、发色
- 不要改变场景的整体布局
- 不要大幅改变镜头角度
- 不要添加首帧中没有的新角色`,
  en: `Based on the reference image (first frame), create the scene's【LAST FRAME / ENDING STATE】image.

## Scene Description
{{sceneDescription}}

## Scene Setting
{{setting}}

## Characters
{{characters}}

## Storyboard Shot
{{storyboardShot}}

## Emotion Transition
- First frame emotion: {{initialEmotion}}
- Last frame emotion: {{finalEmotion}}

## Camera Language Guide
Adjust the frame based on the shot type in storyboard:
- **Extreme wide/Wide shot**: Character takes 10-20% of frame, emphasize environment
- **Medium shot**: Character takes 40-60% of frame, show action and environment relationship
- **Close-up/Extreme close-up**: Character takes 70-90% of frame, emphasize expression and emotion

## Image Requirements

### Must Keep Consistent (Same as First Frame)
1. Same scene location and environment layout
2. Same character appearance (hairstyle, hair color, clothing, accessories must be identical)
3. Same {{style}} art style and color tone
4. Same or similar composition angle and shot type
5. Same lighting tone

### Allowed Changes
1. Character expression changes from "{{initialEmotion}}" to "{{finalEmotion}}"
2. Slight changes in character pose (showing action development)
3. Minor environmental changes (like wind-blown hair, falling leaves, etc.)

### Core Requirements
1. This is the【ENDING STATE】of the scene, showing the result after scene development
2. Must form a coherent animation transition with the first frame
3. 16:9 widescreen ratio, high quality

### Prohibited
- Do not change character clothing, hairstyle, or hair color
- Do not change the overall scene layout
- Do not significantly change camera angle
- Do not add new characters not present in the first frame`
}


// ========== 场景视频生成（资产一致性） ==========
const SCENE_VIDEO_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `【目标】生成单场景视频片段，确保人物与场景资产一致。

【场景】{{sceneTitle}}
【风格】{{style}}
【时长】约 {{duration}} 秒
【输入模式】{{inputMode}}
【参考图说明】{{referenceGuide}}

【一致性约束】
- 角色参考图：{{hasCharacterRef}}
- 环境参考图：{{hasEnvironmentRef}}
- 如存在参考图，必须保持角色身份、服装、发型、体态及环境空间关系稳定
- 不新增与剧情无关的新人物或关键物体
- 不突变时间、地点和光线逻辑

【场景设定】
{{setting}}

【场景描述】
{{sceneDescription}}

【旁白】
{{narration}}

【对白】
{{dialogues}}

【画面要求】
1. 镜头稳定，动作自然，叙事连贯
2. 主体清晰，空间关系明确，景别与构图合理
3. 风格统一，色调和光照连续
4. 适配 {{aspectRatio}} 视频输出`,
  en: `[Goal] Generate a single-scene video clip while preserving character and environment asset consistency.

[Scene] {{sceneTitle}}
[Style] {{style}}
[Duration] around {{duration}} seconds
[Input Mode] {{inputMode}}
[Reference Guide] {{referenceGuide}}

[Consistency Constraints]
- Character reference: {{hasCharacterRef}}
- Environment reference: {{hasEnvironmentRef}}
- When references exist, keep identity, outfit, hairstyle, body shape, and spatial layout stable
- Do not introduce unrelated new people or key objects
- Avoid abrupt jumps in time, location, and lighting logic

[Scene Setting]
{{setting}}

[Scene Description]
{{sceneDescription}}

[Narration]
{{narration}}

[Dialogues]
{{dialogues}}

[Visual Requirements]
1. Stable camera, natural motion, coherent storytelling
2. Clear subject, readable spatial relationship, proper framing
3. Unified style, continuous color tone and lighting
4. Suitable for {{aspectRatio}} video output`
}


// ========== 转场视频 ==========
const TRANSITION_CONTENT: PromptTemplate['content'] = {
  zh: `创建两个场景之间的电影级转场视频。

起始场景：
{{fromScene}}

目标场景：
{{toScene}}

转场风格：{{transitionType}}

要求：
1. 保持两个场景之间的视觉连续性
2. 平滑自然的镜头运动
3. 一致的光线和色彩过渡
4. 如有角色，动作应自然流畅
5. {{style}} 风格，高质量电影级画面

转场应该流畅专业，引导观众的视线从一个场景过渡到下一个场景。`,
  en: `Create a cinematic transition video between two scenes.

FROM SCENE:
{{fromScene}}

TO SCENE:
{{toScene}}

TRANSITION STYLE: {{transitionType}}

REQUIREMENTS:
1. Maintain visual continuity between the two scenes
2. Smooth and natural camera movement
3. Consistent lighting and color grading transition
4. Character movements should flow naturally if present
5. {{style}} style, high quality cinematic look

The transition should feel seamless and professional, guiding the viewer's eye from one scene to the next.`
}


// ========== 背景音乐 ==========
const BGM_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `生成一段{{duration}}秒的背景音乐。

风格: {{mood}}

场景描述: {{sceneDescription}}

要求:
1. 适合作为视频背景音乐
2. 音乐情绪与场景匹配
3. 无人声，纯音乐
4. 高品质音频`,
  en: `Generate a {{duration}}-second background music track.

Style: {{mood}}

Scene description: {{sceneDescription}}

Requirements:
1. Suitable as video background music
2. Music mood matches the scene
3. No vocals, instrumental only
4. High quality audio`
}


// ========== 场景视觉提取 ==========
const SCENE_VISUAL_CONTENT: PromptTemplate['content'] = {
  zh: `你是一位专业的视觉设计师，擅长从场景描述中提取视觉元素。

## 核心任务
提取场景的【环境视觉元素】，用于生成场景背景图。

## 分析思路
1. **时空定位**：时间、地点、季节/天气
2. **视觉元素提取**：主体元素、环境细节、光影效果
3. **氛围营造**：色彩、光影、构图传达情绪
4. **感官细节**：虽然是静态图片，但描述气味、声音等增强代入感

## imagePrompt 生成要求
- 结构：画风 + 场景主体 + 环境细节 + 光影氛围 + 技术参数
- 长度：150-250字（英文）
- 具体性：每个元素都要有具体描述
- 技术参数：结尾加上"高清质量，16:9宽屏"

## 重要说明【必须遵守】
- imagePrompt 中【不要包含】人物角色的描述
- 人物角色会通过单独的角色立绘系统处理
- 只描述场景环境、背景、光影、氛围等非人物元素
- 如果场景中有人物，可以用"留白空间"或"人物活动区域"等方式暗示

## 场景描述
{{sceneDescription}}

## 场景设定
{{setting}}

## 画风
{{style}}

## 输出格式【必须严格遵守】
请输出以下 JSON 格式：
\`\`\`json
{
  "sceneId": "场景ID",
  "time": "时间描述（如：傍晚、黄昏、深夜）",
  "location": "地点描述（如：海边沙滩、城市街道、森林小径）",
  "visualElements": [
    "视觉元素1（如：金色的夕阳）",
    "视觉元素2（如：波光粼粼的海面）",
    "视觉元素3（如：细软的白色沙滩）"
  ],
  "atmosphere": "氛围描述（如：温暖浪漫、宁静祥和、紧张压抑）",
  "sensoryDetails": "感官细节描述（如：海风轻拂、浪花声、咸湿的空气）",
  "imagePrompt": "完整的英文图片生成提示词，150-250字，包含画风+场景主体+环境细节+光影氛围+技术参数，结尾加上 high quality, 16:9 widescreen"
}
\`\`\`

注意：
1. 必须返回完整的 JSON 对象
2. visualElements 是字符串数组，包含 3-6 个视觉元素
3. imagePrompt 必须用英文，且不包含人物描述
4. imagePrompt 结尾必须包含 "high quality, 16:9 widescreen"`,
  en: `You are a professional visual designer, skilled at extracting visual elements from scene descriptions.

## Core Task
Extract【environmental visual elements】from the scene for generating scene background images.

## Analysis Approach
1. **Time-Space Positioning**: time, location, season/weather
2. **Visual Element Extraction**: main elements, environment details, lighting effects
3. **Atmosphere Creation**: colors, lighting, composition conveying emotion
4. **Sensory Details**: though static images, describe smells, sounds to enhance immersion

## imagePrompt Generation Requirements
- Structure: style + scene subject + environment details + lighting atmosphere + technical parameters
- Length: 150-250 words (English)
- Specificity: each element should have concrete description
- Technical parameters: end with "high quality, 16:9 widescreen"

## Important Notes【MUST FOLLOW】
- imagePrompt should【NOT include】character/person descriptions
- Characters will be handled by a separate character portrait system
- Only describe scene environment, background, lighting, atmosphere and other non-character elements
- If there are characters in the scene, use hints like "open space for activity" or "character placement area"

## Scene Description
{{sceneDescription}}

## Scene Setting
{{setting}}

## Style
{{style}}

## Output Format【MUST STRICTLY FOLLOW】
Please output the following JSON format:
\`\`\`json
{
  "sceneId": "Scene ID",
  "time": "Time description (e.g., evening, dusk, midnight)",
  "location": "Location description (e.g., beach, city street, forest path)",
  "visualElements": [
    "Visual element 1 (e.g., golden sunset)",
    "Visual element 2 (e.g., sparkling ocean surface)",
    "Visual element 3 (e.g., soft white sand beach)"
  ],
  "atmosphere": "Atmosphere description (e.g., warm romantic, peaceful serene, tense oppressive)",
  "sensoryDetails": "Sensory details description (e.g., gentle sea breeze, sound of waves, salty air)",
  "imagePrompt": "Complete English image generation prompt, 150-250 words, including style + scene subject + environment details + lighting atmosphere + technical parameters, ending with high quality, 16:9 widescreen"
}
\`\`\`

Notes:
1. Must return complete JSON object
2. visualElements is a string array with 3-6 visual elements
3. imagePrompt must be in English and NOT include character descriptions
4. imagePrompt must end with "high quality, 16:9 widescreen"`
}
