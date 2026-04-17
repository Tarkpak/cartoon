/**
 * 当前工作台主流程默认提示词模板
 * 仅保留：解析 → 资产 → 视频
 */

import type { PromptTemplate } from '../../shared/types/prompt-template'
import { getPromptTemplateMetadataForWorkflow } from '../../shared/types/prompt-template'
import type { ProjectWorkflowType } from '../../shared/types/project'
import {
  normalizeProjectWorkflowType
} from '../../shared/types/project'

type PromptWorkflowInput = ProjectWorkflowType | string | null | undefined

export function getDefaultPromptTemplates(workflow: PromptWorkflowInput = 'asset_consistency'): PromptTemplate[] {
  const normalizedWorkflow = normalizeProjectWorkflowType(workflow)
  const now = new Date().toISOString()
  const metadataList = getPromptTemplateMetadataForWorkflow(normalizedWorkflow)

  return metadataList.map(meta => ({
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

function getDefaultContent(id: string): PromptTemplate['content'] {
  switch (id) {
    case 'script_parsing':
      return SCRIPT_PARSING_CONTENT
    case 'character_sheet':
      return CHARACTER_SHEET_CONTENT
    case 'character_regeneration':
      return CHARACTER_REGENERATION_CONTENT
    case 'environment_reference_generation':
      return ENVIRONMENT_REFERENCE_GENERATION_CONTENT
    case 'scene_description_refinement':
      return SCENE_DESCRIPTION_REFINEMENT_CONTENT
    case 'scene_video_generation':
      return SCENE_VIDEO_GENERATION_CONTENT
    default:
      return {
        zh: '请完成任务。',
        en: 'Please complete the task.'
      }
  }
}

const SCRIPT_PARSING_CONTENT: PromptTemplate['content'] = {
  zh: `你是一位资深分镜师，专注于短视频影视化生产。请把输入文本解析成可直接进入”资产准备 → 场景视频生成”的结构化数据。

【输入文本】
{{novelText}}

【项目画风】
{{style}}

【输入规模】
- 文本长度：约 {{textLength}} 字
- 建议最少场景数：{{recommendedMinScenes}} 场
- 单场时长范围：{{sceneDurationMin}}-{{sceneDurationMax}} 秒

【核心目标】
1. 必须覆盖原文完整主线，不得省略关键事件、关键情绪转折和关键旁白。
2. 输出结果必须直接服务当前工作台主流程：后续要生成角色资产、环境参考图和场景视频。
3. 每个场景都要足够“可拍”，描述应体现环境、角色、动作、镜头重点和关键道具。

【场景拆分规则】
1. 当地点变化、时间跳跃、动作阶段变化、情绪明显转折、叙事视角切换时，必须拆分新场景。
2. 若同一段落里包含多个动作转折或叙事跳跃，必须拆成连续多个场景。
3. 场景数量不得少于 {{recommendedMinScenes}} 场；如果剧情密度更高，应继续增加场景。
4. 每个场景的 duration 必须是数字，且在 {{sceneDurationMin}}-{{sceneDurationMax}} 秒之间。
5. totalDuration 必须严格等于所有 scenes[i].duration 的总和。

【场景字段规则】
1. scenes[i].shotType 只能是：extreme_wide、wide、medium_wide、medium、medium_close、close、extreme_close、detail。
2. scenes[i].setting.timeOfDay 只能是：dawn、morning、noon、afternoon、evening、night。
3. scenes[i].setting.location 请优先使用“主环境-子空间”或“主环境/子空间”的中性命名。
4. 同一主环境在不同子空间中必须保持一致的建筑年代、装修档次、材质语言和维护状态。
5. 除非原文明确说明新旧分区或废弃区，禁止输出互相冲突的环境风格。

【description 时间轴规则】
1. 每个场景的 description 必须是多行时间轴镜头脚本，不得写成散文段落。
2. 每行格式必须是：起始-结束秒：，景别，运镜方式。画面动作与对白。
   - 景别如：中景、近景、特写镜头、中近景、全景、大远景等。
   - 运镜方式如：固定镜头、缓慢推近、缓慢拉远、镜头左摇、镜头右摇、跟随镜头、手持镜头等。
   - 可在运镜后补充镜头角度或特殊说明，如：，镜头角度略低于XX的视线。
3. 每个场景至少 2 行，建议 3-6 行；时间轴从 0 开始，最后一行结束时间应与 duration 对齐或接近（误差不超过 0.5 秒）。
4. 对话要直接写在对应镜头行中，用单引号包裹，例如：陆哲说：'你们等着看。'
5. 旁白/画外音必须嵌入对应镜头行中，格式：画外音（音色：性别，年龄段，语调描述，音高，语速，情绪，口音）说：'旁白内容'。
   示例：画外音（音色：男性，30岁左右，语调平静而富有叙事感，音高中等，语速适中，情绪内敛，无口音）说：'那份冰冷的文件，像一把钝刀。'
6. 每行应包含丰富的镜头语言：光线描写、空间关系、人物动作细节、环境氛围与声音描写。
7. description 中禁止写"添加字幕/BGM/音效"等制作指令。
8. 若使用引用标签，只允许标准格式 [图片N]；禁止 [角色名]、[地点名] 等自定义方括号标签。

【角色与旁白规则】
1. 只识别真实角色，不要把旁白、画外音、系统说明、音效、抽象概念当作角色。
2. 场景中的旁白、画外音、内心独白必须同时输出到 scenes[i].narration 字段，并以画外音格式嵌入 description 的对应时间轴行中。
3. dialogues 仅保留真实角色台词，不要把“旁白”写成角色。
4. characters 数组中的角色描述要稳定可复用，便于后续角色资产生成。
5. 对每个场景，明确角色、环境和关键道具等资产需求，但不要额外新增无关元素。

【输出格式】
请严格输出 JSON：
\`\`\`json
{
  "title": "剧本标题（可选）",
  "scenes": [
    {
      "id": "scene_001",
      "title": "场景标题",
      "shotType": "extreme_wide|wide|medium_wide|medium|medium_close|close|extreme_close|detail",
      "description": "0-3秒：，中景，固定镜头。护士站[图片1]走廊白炽灯映出冷硬的墙面，人来人往，陆哲[图片2]抬手整理白大褂，动作从容。\\n3-6秒：，近景，缓慢推近。陆哲[图片2]嘴角上扬，眼神中透着志在必得的冷傲。陆哲说：'你们等着看。'\\n6-8秒：，中景，固定镜头。画外音（音色：男性，30岁左右，语调沉稳，音高偏低，语速适中，情绪克制，无口音）说：'他的目光穿过人群，像一把隐忍的刀。'",
      "setting": {
        "location": "医院-护士站",
        "timeOfDay": "night",
        "mood": "紧绷压迫",
        "weather": "暴雨（可选）"
      },
      "characters": [
        {
          "name": "陆哲",
          "appearance": "角色在此场景中的外观描述",
          "emotion": "neutral|happy|sad|angry|surprised|scared|worried|determined"
        }
      ],
      "dialogues": [
        {
          "character": "陆哲",
          "text": "你们等着看。",
          "emotion": "determined"
        }
      ],
      "narration": "旁白/画外音（可选）",
      "duration": 8
    }
  ],
  "characters": [
    {
      "name": "陆哲",
      "description": "角色整体外貌描述，便于后续角色资产生成",
      "role": "protagonist|antagonist|supporting"
    }
  ],
  "totalDuration": 96
}
\`\`\`

只输出 JSON，不要附加解释。`,
  en: `You are a senior screenplay parser for short-form cinematic production. Convert the input text into structured data that can directly enter the current workbench pipeline: parse -> assets -> scene video generation.

## Input Text
{{novelText}}

## Project Style
{{style}}

## Input Scale
- Text length: about {{textLength}} characters
- Recommended minimum scene count: {{recommendedMinScenes}}
- Per-scene duration range: {{sceneDurationMin}}-{{sceneDurationMax}} seconds

## Core Goals
1. Cover the full plot. Do not skip key events, emotional turns, or important narration.
2. The output must directly support later character assets, environment references, and scene videos.
3. Every scene must be visually generatable, with clear environment, characters, action, focal details, and key props.

## Scene Splitting Rules
1. Split scenes whenever location, time, action phase, emotional direction, or narrative perspective changes.
2. If one passage contains multiple action turns or narrative jumps, split it into consecutive scenes.
3. The result must contain at least {{recommendedMinScenes}} scenes. Add more if the story density requires it.
4. Each duration must be numeric and stay within {{sceneDurationMin}}-{{sceneDurationMax}} seconds.
5. totalDuration must equal the sum of all scenes[i].duration.

## Scene Field Rules
1. scenes[i].shotType must be one of: extreme_wide, wide, medium_wide, medium, medium_close, close, extreme_close, detail.
2. scenes[i].setting.timeOfDay must be one of: dawn, morning, noon, afternoon, evening, night.
3. scenes[i].setting.location should use neutral naming such as "root environment - subspace".
4. The same root environment must keep consistent era, material language, maintenance level, and renovation grade across scenes.
5. Do not output conflicting environment styles unless the source explicitly describes different zones.

## Timeline Description Rules
1. Each scene description must be a multi-line timeline shot script, not prose.
2. Each line must follow the format (use Chinese tokens exactly): start-end秒：，景别，运镜方式。Visual action and dialogue.
   - 景别 (shot sizes): 中景, 近景, 特写镜头, 中近景, 全景, 大远景, etc.
   - 运镜方式 (camera movements): 固定镜头, 缓慢推近, 缓慢拉远, 镜头左摇, 镜头右摇, 跟随镜头, 手持镜头, etc.
   - Additional camera info may follow, e.g.: ，镜头角度略低于XX的视线。
3. Each scene needs at least 2 lines, preferably 3-6. Timeline starts at 0 and the final line should align with duration within 0.5 seconds.
4. Put dialogue directly inside the relevant timeline line, wrapped in single quotes.
5. Narration/voiceover must be embedded in the timeline line using format: 画外音（音色：gender，age range，tone description，pitch，speed，emotion，accent）说：'narration content'.
6. Each line should include rich cinematic language: lighting, spatial relationships, character action details, atmosphere, and ambient sound.
7. Do not include production instructions such as subtitles, BGM, or SFX.
8. If reference tags are used, only use the standard format [ImageN].

## Character and Narration Rules
1. Only identify real characters. Do not treat narration, voice-over, system text, or sound cues as characters.
2. Narration, voice-over, and inner monologue must go to scenes[i].narration AND be embedded as voiceover in the description timeline lines.
3. dialogues must only contain real spoken lines by actual characters.
4. Character descriptions must stay stable and reusable for later asset generation.
5. Make asset needs clear through the scene content, but do not invent unrelated elements.

## Output Format
Output strict JSON only:
\`\`\`json
{
  "title": "Optional script title",
  "scenes": [
    {
      "id": "scene_001",
      "title": "Scene title",
      "shotType": "extreme_wide|wide|medium_wide|medium|medium_close|close|extreme_close|detail",
      "description": "0-3秒：，中景，固定镜头。Busy nurse station[Image1] under cold fluorescent light, Lu Zhe[Image2] adjusts his white coat.\\n3-6秒：，近景，缓慢推近。Lu Zhe[Image2] smirks with cold confidence. Lu Zhe says: 'Wait and see.'\\n6-8秒：，中景，固定镜头。画外音（音色：male，around 30，steady tone，low-mid pitch，moderate pace，restrained，no accent）says: 'His gaze cuts through the crowd like a hidden blade.'",
      "setting": {
        "location": "Hospital - nurse station",
        "timeOfDay": "night",
        "mood": "tense and oppressive",
        "weather": "stormy rain"
      },
      "characters": [
        {
          "name": "Lu Zhe",
          "appearance": "Appearance in this scene",
          "emotion": "neutral|happy|sad|angry|surprised|scared|worried|determined"
        }
      ],
      "dialogues": [
        {
          "character": "Lu Zhe",
          "text": "Wait and see.",
          "emotion": "determined"
        }
      ],
      "narration": "Optional narration",
      "duration": 8
    }
  ],
  "characters": [
    {
      "name": "Lu Zhe",
      "description": "Reusable overall appearance description for later asset generation",
      "role": "protagonist|antagonist|supporting"
    }
  ],
  "totalDuration": 96
}
\`\`\`

Output JSON only, with no extra explanation.`
}

const CHARACTER_SHEET_CONTENT: PromptTemplate['content'] = {
  zh: `为 {{characterName}} 创建一张 {{style}} 风格的角色资产设定板。

角色外貌基线：
{{appearance}}

执行要求：
1. 输出必须是单角色角色资产图，不要输出文字说明。
2. 16:9 横版构图，纯白或浅灰背景，适合后续作为角色一致性参考。
3. 左侧为脸部近景，右侧为 Front / Profile / Back 三视图全身站姿。
4. 三视图必须等比例、等身高、等服装结构，对齐清晰。
5. 严格依据角色外貌描述，避免任意添加新设定。
6. 若模型接收到参考图，必须优先保持身份一致：脸型、五官、发型、服装、配饰不可漂移。
7. 画面干净、结构清晰、细节稳定，不要戏剧化背景，不要多人同框，不要水印和 Logo。`,
  en: `Create a {{style}} character asset design sheet for {{characterName}}.

Appearance baseline:
{{appearance}}

Requirements:
1. The result must be an image asset sheet, not text.
2. Use a 16:9 horizontal composition with a clean white or light-gray background for identity consistency reference.
3. Put a close-up portrait on the left and full-body Front / Profile / Back turnarounds on the right.
4. Turnarounds must stay aligned with consistent scale, height, and outfit structure.
5. Follow the provided appearance strictly and do not invent unrelated new traits.
6. If a reference image is provided by the model layer, identity consistency must take priority.
7. Keep the frame clean, readable, stable, watermark-free, and free of dramatic background storytelling.`
}

const CHARACTER_REGENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `你正在执行“角色资产二次生成”任务，请直接生成修改后的角色图片，不要输出文字解释。

角色信息：
- 名称：{{characterName}}
- 外貌基线：{{appearance}}
- 风格基线：{{style}}

本次生效的修改要求：
{{activeStyleConstraint}}

补充说明（可能为空）：
{{customPrompt}}

执行要求：
1. 必须保持同一角色身份，不得改变年龄段、性别呈现、脸型与核心五官结构。
2. 除非用户明确要求，否则不得改动发型、发色、服装结构和关键配饰。
3. 只执行明确提出的修改项，不扩展额外创作，不新增无关元素。
4. 输出必须是高质量图片，不要返回纯文本。
5. 构图稳定、主体清晰、光影自然，避免过饱和、过锐化和塑料质感。`,
  en: `You are performing a character asset regeneration task. Generate the edited character image directly and do not return explanatory text.

Character info:
- Name: {{characterName}}
- Appearance baseline: {{appearance}}
- Style baseline: {{style}}

Effective change request:
{{activeStyleConstraint}}

Supplementary note (may be empty):
{{customPrompt}}

Requirements:
1. Keep the same character identity. Do not change age presentation, gender presentation, face shape, or key facial structure.
2. Do not change hairstyle, hair color, outfit structure, or key accessories unless explicitly requested.
3. Apply only the requested edits and do not introduce unrelated creativity.
4. The output must be a high-quality image, not plain text.
5. Keep composition stable, subject clear, and lighting natural without oversharpening or oversaturation.`
}

const ENVIRONMENT_REFERENCE_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `你正在为“素材一致性场景视频”生成单张纯环境参考图。请直接生成图片，不要输出文字说明。

【项目画风】
{{style}}

【输出比例】
{{aspectRatio}}

【场景标题】
{{sceneTitle}}

【场景描述】
{{sceneDescription}}

【场景设定】
{{setting}}

【环境连续性要求】
{{environmentConsistency}}

【镜头与资产备注】
{{cameraNote}}

【旁白】
{{narration}}

【关键对白】
{{dialogues}}

【二次生成补充要求】
{{customPrompt}}

【执行要求】
1. 只生成 1 张环境资产图，不要拼图，不要分镜排版，不要多画面组合。
2. 这是一张纯环境参考图：禁止出现人物、人脸、肢体、剪影、人群。
3. 若原文包含人物动作或对白，只提取地点、建筑、地形、道具、光照、天气与空间关系。
4. 画面必须覆盖该场景的核心空间结构，方便后续视频沿用同一环境基底。
5. 同一主环境的年代感、装修档次、材质语言、灯光体系必须和相邻场景保持一致。
6. 不要文字、水印、Logo、边框、界面元素。
7. 如果提供了二次生成要求，只做定向微调，不改变环境主体身份。`,
  en: `You are generating a single pure environment reference image for an asset-consistent scene video workflow. Return the image directly, not text.

## Project Style
{{style}}

## Output Aspect Ratio
{{aspectRatio}}

## Scene Title
{{sceneTitle}}

## Scene Description
{{sceneDescription}}

## Scene Setting
{{setting}}

## Environment Continuity Requirements
{{environmentConsistency}}

## Camera and Asset Notes
{{cameraNote}}

## Narration
{{narration}}

## Key Dialogue
{{dialogues}}

## Regeneration Note
{{customPrompt}}

## Requirements
1. Generate exactly one environment asset image, not a collage, layout sheet, or split-panel composition.
2. This must be a pure environment reference: no humans, faces, body parts, silhouettes, or crowds.
3. If the source contains human action or dialogue, extract only location, architecture, terrain, props, lighting, weather, and spatial structure.
4. The frame must clearly establish the core space so later scene videos can reuse the same environment baseline.
5. Keep era, renovation grade, material language, and lighting system consistent with neighboring scenes in the same root environment.
6. No text, watermark, logo, border, or UI elements.
7. If a regeneration note is provided, apply only targeted environment-level refinement without changing the core environment identity.`
}

const SCENE_DESCRIPTION_REFINEMENT_CONTENT: PromptTemplate['content'] = {
  zh: `你是一名资深影视场景编辑，负责根据用户指令改写当前场景描述。请严格输出 JSON：
{"description":"改写后的场景描述"}

【项目画风】
{{style}}

【场景标题】
{{sceneTitle}}

【当前场景描述】
{{sceneDescription}}

【场景设定】
{{setting}}

【角色信息】
{{characters}}

【旁白】
{{narration}}

【对白】
{{dialogues}}

【历史编辑对话】
{{history}}

【本次用户指令】
{{userMessage}}

【本次提及资产】
{{mentionedAssets}}

【输出要求】
1. 仅输出 JSON，不要任何解释。
2. description 必须保持“时间轴分行”格式，不得改成普通段落。
3. 总时长参考约 {{durationHint}} 秒；至少输出 1 行时间轴，通常输出 2-6 行。
4. 每行格式：起始-结束秒：，景别，运镜方式。画面描述。运镜方式如：固定镜头、缓慢推近、缓慢拉远等。旁白请用画外音格式嵌入。
5. 必须融合用户本次修改意图，并保持剧情连续、角色身份一致、环境逻辑一致。
6. 若提到资产（角色/环境/道具），应体现在描述里，但不要输出 @mention 或 [引用资产] 区块。
7. 保留 [图片N] 标签风格；若原描述已有 [图片N]，优先沿用。
8. 不要输出“添加字幕/BGM/音效”等制作指令。
9. 若原描述已具备明确时间轴结构，应在此基础上重写，而不是退化成概述。`,
  en: `You are a senior scene editor. Rewrite the current scene description based on the user's instruction and output strict JSON only:
{"description":"rewritten scene description"}

## Project Style
{{style}}

## Scene Title
{{sceneTitle}}

## Current Scene Description
{{sceneDescription}}

## Scene Setting
{{setting}}

## Character Info
{{characters}}

## Narration
{{narration}}

## Dialogue
{{dialogues}}

## Recent Edit History
{{history}}

## Current User Instruction
{{userMessage}}

## Mentioned Assets
{{mentionedAssets}}

## Output Rules
1. Output JSON only, with no explanation.
2. description must stay in multi-line timeline format, not prose.
3. The target duration is about {{durationHint}} seconds; output at least one timeline line and usually 2-6 lines.
4. Each line must follow the format (use Chinese tokens exactly): start-end秒：，景别，运镜方式。Visual description. 运镜方式 includes: 固定镜头, 缓慢推近, 缓慢拉远, etc.
5. Integrate the user's requested changes while preserving plot continuity, character identity, and environment logic.
6. If assets are mentioned, reflect them in the scene description, but do not output @mentions or asset-reference blocks.
7. Preserve the [ImageN] tag style. If existing tags are already present, reuse them whenever possible.
8. Do not output production instructions such as subtitles, BGM, or SFX.
9. If the source already has a clear timeline structure, rewrite within that structure instead of collapsing it into summary prose.`
}

const SCENE_VIDEO_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `你正在生成单场景视频提示词。请围绕“参考素材一致、动作自然、镜头连贯、空间关系稳定”组织描述。

镜头 {{shotNumber}}
{{sceneSummary}}

【画风】
{{style}}

【时长】
约 {{duration}} 秒

【画幅】
{{aspectRatio}}

【时间轴描述】
{{timelineLines}}

【参考图说明】
{{referenceGuide}}

【参考素材】
{{referenceMaterials}}

【执行约束】
{{executionConstraints}}

【补充信息】
- 输入模式：{{inputMode}}
- 角色参考图：{{hasCharacterRef}}
- 环境参考图：{{hasEnvironmentRef}}
- 旁白：{{narration}}
- 对白：{{dialogues}}

结果应强调：角色身份稳定、环境连续、动作自然、镜头语言清晰。`,
  en: `You are building a single-scene video prompt. Organize the prompt around reference consistency, natural motion, coherent camera language, and stable spatial continuity.

Shot {{shotNumber}}
{{sceneSummary}}

## Style
{{style}}

## Duration
About {{duration}} seconds

## Aspect Ratio
{{aspectRatio}}

## Timeline Description
{{timelineLines}}

## Reference Guide
{{referenceGuide}}

## Reference Materials
{{referenceMaterials}}

## Execution Constraints
{{executionConstraints}}

## Extra Context
- Input mode: {{inputMode}}
- Character reference available: {{hasCharacterRef}}
- Environment reference available: {{hasEnvironmentRef}}
- Narration: {{narration}}
- Dialogue: {{dialogues}}

The final prompt should emphasize stable identity, environment continuity, natural motion, and clear cinematic intent.`
}
