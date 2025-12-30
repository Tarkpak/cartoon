/**
 * 默认提示词模板
 * 包含所有模块的中英双语默认提示词
 * 已合并系统提示词和用户提示词为单一提示词
 */

import type { PromptTemplate } from '../../shared/types/prompt-template'
import { PROMPT_TEMPLATE_METADATA } from '../../shared/types/prompt-template'

/**
 * 获取所有默认提示词模板
 */
export function getDefaultPromptTemplates(): PromptTemplate[] {
  const now = new Date().toISOString()

  return PROMPT_TEMPLATE_METADATA.map(meta => ({
    id: meta.id,
    name: meta.name,
    category: meta.category,
    description: meta.description,
    variables: meta.variables,
    content: getDefaultContent(meta.id),
    isCustomized: false,
    updatedAt: now
  }))
}

/**
 * 获取指定模板的默认内容
 */
function getDefaultContent(id: string): PromptTemplate['content'] {
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
    case 'frame_generation':
      return FRAME_GENERATION_CONTENT
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

### 内容要求（基于漫剧创作原则）

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
  zh: `你是一位专业的漫剧分镜师，擅长将小说文本转换为可视化的场景描述。

## 核心任务
将输入的小说/剧本文本拆分成适合漫剧制作的场景序列。

## 场景拆分原则

### 1. 视觉变化原则
当以下任一情况发生时，应该开始新场景：
- 地点变化（从室内到室外、从A地到B地）
- 时间跳跃（从白天到夜晚、时间流逝）
- 视角切换（从角色A视角到角色B视角）
- 情绪转折（从欢乐到悲伤、从平静到紧张）

### 2. 时长控制
- 每个场景建议时长：5-15秒
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

## 输入文本
{{novelText}}

## 画风参考
{{style}}

请输出 JSON 格式的场景列表。`,
  en: `You are a professional manga storyboard artist, skilled at converting novel text into visual scene descriptions.

## Core Task
Split the input novel/script text into scene sequences suitable for manga production.

## Scene Splitting Principles

### 1. Visual Change Principle
Start a new scene when any of the following occurs:
- Location change (indoor to outdoor, place A to place B)
- Time jump (day to night, time passage)
- Perspective switch (character A's view to character B's view)
- Emotional shift (joy to sadness, calm to tension)

### 2. Duration Control
- Recommended duration per scene: 5-15 seconds
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

## Input Text
{{novelText}}

## Style Reference
{{style}}

Output in JSON format.`
}


// ========== 场景生成 ==========
const SCENE_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `你是一位专业的漫剧编剧。请根据以下故事大纲和角色设定，生成详细的分场剧本。

## 故事信息
{{outline}}

## 角色设定（重要：场景描述中出现角色时，必须使用这里的外貌描述）
{{characters}}

## 场景生成要求

### 数量和分布
- 生成 {{targetSceneCount}} 个场景
- 第一幕（铺垫）：约 25% 的场景
- 第二幕（对抗）：约 50% 的场景
- 第三幕（解决）：约 25% 的场景

### 视觉描述要求（用于 AI 图片生成）
1. 每个场景的 description 必须是具体、可视化的画面描述
2. 包含：环境细节、光线效果、色调氛围、角色位置和姿态
3. 角色出现时，必须包含其外貌特征
4. 描述长度：100-200字

### 对话要求
1. 对话要简洁有力，每句不超过20字
2. 符合角色性格和说话风格
3. 推动剧情发展，避免废话
4. 每个场景 1-3 句对话为宜

请输出 JSON 数组格式的场景列表。`,
  en: `You are a professional manga screenwriter. Please generate detailed scene scripts based on the following story outline and character settings.

## Story Information
{{outline}}

## Character Settings (Important: When characters appear in scene descriptions, use the appearance descriptions provided here)
{{characters}}

## Scene Generation Requirements

### Quantity and Distribution
- Generate {{targetSceneCount}} scenes
- Act 1 (Setup): ~25% of scenes
- Act 2 (Confrontation): ~50% of scenes
- Act 3 (Resolution): ~25% of scenes

### Visual Description Requirements (for AI image generation)
1. Each scene's description must be specific, visual imagery
2. Include: environment details, lighting effects, color atmosphere, character positions and poses
3. When characters appear, include their physical features
4. Description length: 100-200 words

### Dialogue Requirements
1. Dialogue should be concise and powerful, no more than 20 words per line
2. Match character personality and speaking style
3. Drive the plot forward, avoid filler
4. 1-3 lines of dialogue per scene is ideal

Output as JSON array of scenes.`
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

## 重要提示
- 第一个镜头的 visualContent 将用于生成首帧图片
- 最后一个镜头的 visualContent 将用于生成尾帧图片
- 这两个镜头的描述必须特别详细和具体

## 场景描述
{{sceneDescription}}

## 对话
{{dialogues}}

## 画风
{{style}}

请输出 JSON 格式的分镜脚本。`,
  en: `You are a professional storyboard artist, skilled at converting scene descriptions into detailed storyboard scripts.

## Storyboard Elements
Each shot needs to include:
1. Shot number (shotNumber)
2. Shot type (shotType): extreme_wide, wide, medium_wide, medium, medium_close, close, extreme_close, detail
3. Visual content (visualContent): detailed visual description
4. Dialogue (dialogue): if any
5. Duration (duration): seconds
6. Camera movement (cameraMovement): static, push, pull, pan_left, pan_right, track, dolly, zoom_in, zoom_out, tilt_up, tilt_down, crane, handheld, arc

## Important Notes
- The first shot's visualContent will be used to generate the first frame image
- The last shot's visualContent will be used to generate the last frame image
- These two shots' descriptions must be particularly detailed and specific

## Scene Description
{{sceneDescription}}

## Dialogues
{{dialogues}}

## Style
{{style}}

Output in JSON format.`
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

## 输入内容
{{content}}

## 画风参考
{{style}}

请输出 JSON 格式的角色列表，每个角色包含 role（角色名）和 role_content（外貌描述）。`,
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

## Input Content
{{content}}

## Style Reference
{{style}}

Output as JSON array with role (character name) and role_content (appearance description).`
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

## 输出格式
请输出 JSON 数组，每个角色包含：
- name: 角色名
- role: protagonist/antagonist/supporting
- appearance: 外貌描述（英文，用于图片生成）
- personality: 性格特点
- traits: 性格标签数组
- background: 背景故事
- motivation: 动机
- speakingStyle: 说话风格
- age: 年龄
- gender: 性别`,
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

## Output Format
Output as JSON array, each character containing:
- name, role, appearance, personality, traits, background, motivation, speakingStyle, age, gender`
}


// ========== 角色设定图 ==========
const CHARACTER_SHEET_CONTENT: PromptTemplate['content'] = {
  zh: `为 {{characterName}} 创建一张专业的动漫角色设定图。

角色外貌：{{appearance}}

画风：{{style}}

布局要求：
- 画布比例：16:9 横向
- 背景：纯白色或浅灰色渐变
- 主要内容：三视图（占画布 65-75%）
  - 左侧：正面视图
  - 中间：3/4 侧面视图
  - 右侧：背面视图
- 三个视图高度一致，头部和脚部对齐
- 高质量，线条清晰锐利

禁止包含：复杂背景、角色被裁切、视图不一致、大段文字、多个角色、过于复杂的姿势`,
  en: `Create a professional anime character reference sheet for {{characterName}}.

Character appearance: {{appearance}}

Style: {{style}}

Layout requirements:
- Canvas ratio: 16:9 horizontal
- Background: pure white or light gray gradient
- Main content: Three-view (65-75% of canvas)
  - Left: Front view
  - Center: 3/4 view
  - Right: Back view
- All three views should have equal height, aligned at head and feet
- High quality, clean sharp lines

DO NOT include: complex backgrounds, cropped characters, inconsistent views, large text blocks, multiple characters, overly complex poses`
}


// ========== 首尾帧生成 ==========
const FRAME_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `生成一张高质量的动漫场景图片。

场景：{{sceneDescription}}

场景中的角色：{{characters}}

画风：{{style}}

这是场景的 {{isFirstFrame}} 帧。

要求：
- 电影级构图
- 详细的环境和光影效果
- 角色表情和姿势与场景氛围匹配
- 16:9 宽高比
- 高质量插画`,
  en: `Generate a high-quality anime scene image.

Scene: {{sceneDescription}}

Characters in scene: {{characters}}

Style: {{style}}

This is the {{isFirstFrame}} frame of the scene.

Requirements:
- Cinematic composition
- Detailed environment and lighting
- Character expressions and poses matching the scene mood
- 16:9 aspect ratio
- High quality illustration`
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

## 场景描述
{{sceneDescription}}

## 场景设定
{{setting}}

## 画风
{{style}}

请输出 JSON 格式，包含 time, location, visualElements, atmosphere, sensoryDetails, imagePrompt 字段。`,
  en: `You are a professional visual designer, skilled at extracting visual elements from scene descriptions.

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

## Scene Description
{{sceneDescription}}

## Scene Setting
{{setting}}

## Style
{{style}}

Output in JSON format with time, location, visualElements, atmosphere, sensoryDetails, imagePrompt fields.`
}
