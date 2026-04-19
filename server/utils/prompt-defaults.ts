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
2. 同一地点、同一时间、同一连续戏剧动作内，如果只是镜头切换、视角切换、表情推进、台词递进，不要拆场景，应在 description 内做逐秒拆镜。
3. 只有当“场景功能”发生变化时再拆场景，例如：开场钩子、矛盾升级、反击转折、结尾宣言。
4. 场景数量不得少于 {{recommendedMinScenes}} 场；如果剧情密度更高，应继续增加场景，但不要为了凑场景数把一个完整对峙切碎。
5. 每个场景的 duration 必须是数字，且在 {{sceneDurationMin}}-{{sceneDurationMax}} 秒之间。
6. totalDuration 必须严格等于所有 scenes[i].duration 的总和。

【场景字段规则】
1. scenes[i].shotType 只能是：extreme_wide、wide、medium_wide、medium、medium_close、close、extreme_close、detail。
2. scenes[i].cameraMovement 只能是：static、push、pull、pan_left、pan_right、tilt_up、tilt_down、track、dolly、zoom_in、zoom_out、crane、handheld、arc。选择最能代表该场景主运镜方式的值。
3. scenes[i].setting.timeOfDay 只能是：黎明、早晨、白天、中午、下午、傍晚、夜晚。
4. scenes[i].setting.location 请优先使用”主环境-子空间”或”主环境/子空间”的中性命名。
5. 同一主环境在不同子空间中必须保持一致的建筑年代、装修档次、材质语言和维护状态。
6. 除非原文明确说明新旧分区或废弃区，禁止输出互相冲突的环境风格。

【description 富化规则】
1. 每个场景的 description 必须是“可直接拍摄”的详细场景说明块，不得只写一句概述，也不要退化成纯散文。
2. description 请尽量按下面结构组织，并把信息直接写在同一个字符串里：
   场景功能/情绪定位：一句话概括该场景的戏剧功能与情绪曲线
   镜头设计：
   0-2秒：……
   2-4秒：……
   声音设计：
   - ……
   台词节奏：
   - ……
   表演关键点：
   - ……
3. “镜头设计”中的每行格式必须是：起始-结束秒：，景别，运镜方式。画面动作与对白。
   - 景别如：中景、近景、特写镜头、中近景、全景、大远景等。
   - 运镜方式如：固定镜头、缓慢推近、缓慢拉远、镜头左摇、镜头右摇、跟随镜头、手持镜头等。
   - 可在运镜后补充镜头角度或特殊说明，如：，镜头角度略低于XX的视线。
4. 每个场景至少 2 行镜头设计，建议 3-6 行；时间轴从 0 开始，最后一行结束时间应与 duration 对齐或接近（误差不超过 0.5 秒）。
5. 对于强戏剧冲突、对峙、告白、反转、觉醒等核心戏，优先给 8-15 秒并在单场景内部拆镜；2-6 秒只留给过渡、反应或闪回补刀镜头。
6. 对话要直接写在对应镜头行中，用单引号包裹，例如：陆哲说：'你们等着看。'
7. 旁白/画外音必须嵌入对应镜头行中，格式：画外音（音色：性别，年龄段，语调描述，音高，语速，情绪，口音）说：'旁白内容'。
   示例：画外音（音色：男性，30岁左右，语调平静而富有叙事感，音高中等，语速适中，情绪内敛，无口音）说：'那份冰冷的文件，像一把钝刀。'
8. “声音设计”里写环境音、关键音效、语气和节奏；“表演关键点”里写眼神、停顿、微表情、手部动作、身体重心变化等。
9. 每行应包含丰富的镜头语言：光线描写、空间关系、人物动作细节、环境氛围与声音描写。
10. description 中禁止写"添加字幕/BGM/音效"等制作指令，但可以写“环境音/低频嗡鸣/玻璃碎声”等叙事内声音设计。
11. 不要自行生成任何 [图片N] 或其他引用编号；如系统后续需要引用标签，会由后处理统一注入。

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
      "cameraMovement": "static|push|pull|pan_left|pan_right|tilt_up|tilt_down|track|dolly|zoom_in|zoom_out|crane|handheld|arc",
      "description": "场景功能/情绪定位：公开压迫，主角第一次显出反击前的冷感。\\n镜头设计：\\n0-2秒：，中景，固定镜头。护士站走廊白炽灯映出冷硬的墙面，人来人往，陆哲抬手整理白大褂，动作从容。\\n2-5秒：，近景，缓慢推近。陆哲嘴角上扬，眼神中透着志在必得的冷傲。陆哲说：'你们等着看。'\\n5-8秒：，中景，固定镜头。画外音（音色：男性，30岁左右，语调沉稳，音高偏低，语速适中，情绪克制，无口音）说：'他的目光穿过人群，像一把隐忍的刀。'\\n声音设计：\\n- 环境音以护士站脚步声、推车轮声和广播底噪为主。\\n- 陆哲开口前压低环境声，让台词更顶。\\n台词节奏：\\n- '你们等着看。'前短停半拍，后半句咬字更重。\\n表演关键点：\\n- 整理白大褂时手势克制而笃定。\\n- 说完台词后不要立刻转身，留一个带轻蔑意味的停顿。",
      "setting": {
        "location": "医院-护士站",
        "timeOfDay": "夜晚",
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
2. If the location and dramatic action remain continuous, do not split just because the camera angle changes or the acting beat progresses. Keep those details inside the same scene description as second-by-second beat design.
3. Only create a new scene when the dramatic function changes, for example: hook, escalation, reversal, declaration, aftermath.
4. The result must contain at least {{recommendedMinScenes}} scenes. Add more only when story density truly requires it, not to over-fragment one confrontation.
5. Each duration must be numeric and stay within {{sceneDurationMin}}-{{sceneDurationMax}} seconds.
6. totalDuration must equal the sum of all scenes[i].duration.

## Scene Field Rules
1. scenes[i].shotType must be one of: extreme_wide, wide, medium_wide, medium, medium_close, close, extreme_close, detail.
2. scenes[i].cameraMovement must be one of: static, push, pull, pan_left, pan_right, tilt_up, tilt_down, track, dolly, zoom_in, zoom_out, crane, handheld, arc. Pick the dominant camera movement for the scene.
3. scenes[i].setting.timeOfDay must be one of: 黎明, 早晨, 白天, 中午, 下午, 傍晚, 夜晚.
4. scenes[i].setting.location should use neutral naming such as "root environment - subspace".
5. The same root environment must keep consistent era, material language, maintenance level, and renovation grade across scenes.
6. Do not output conflicting environment styles unless the source explicitly describes different zones.

## Rich Description Rules
1. Each scene description must be a detailed, production-ready scene block, not a one-line summary and not plain prose.
2. Prefer organizing description inside the same string with this structure:
   Scene function / emotional beat: one-line summary
   Shot design:
   0-2秒：...
   2-4秒：...
   Sound design:
   - ...
   Dialogue rhythm:
   - ...
   Performance notes:
   - ...
3. Under "Shot design", each line must follow the format (use Chinese tokens exactly): start-end秒：，景别，运镜方式。Visual action and dialogue.
   - 景别 (shot sizes): 中景, 近景, 特写镜头, 中近景, 全景, 大远景, etc.
   - 运镜方式 (camera movements): 固定镜头, 缓慢推近, 缓慢拉远, 镜头左摇, 镜头右摇, 跟随镜头, 手持镜头, etc.
   - Additional camera info may follow, e.g.: ，镜头角度略低于XX的视线。
4. Each scene needs at least 2 shot-design lines, preferably 3-6. Timeline starts at 0 and the final line should align with duration within 0.5 seconds.
5. For major dramatic confrontation, confession, reversal, awakening, or payoff scenes, prefer 8-15 seconds and expand detail inside one scene. Use 2-6 seconds mainly for transitions, reaction inserts, or flashback fragments.
6. Put dialogue directly inside the relevant timeline line, wrapped in single quotes.
7. Narration/voiceover must be embedded in the timeline line using format: 画外音（音色：gender，age range，tone description，pitch，speed，emotion，accent）说：'narration content'.
8. Use "Sound design" for ambient sound, key effects, voice pressure, and rhythm. Use "Performance notes" for gaze, pauses, micro-expressions, hand tension, posture, and body-weight shifts.
9. Each timeline line should include rich cinematic language: lighting, spatial relationships, character action details, atmosphere, and ambient sound.
10. Do not include production instructions such as subtitles, BGM, or UI overlays, but narrative sound design is allowed.
11. Do not invent any [ImageN] or other reference numbering. If reference tags are needed later, the system will inject them in post-processing.

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
      "cameraMovement": "static|push|pull|pan_left|pan_right|tilt_up|tilt_down|track|dolly|zoom_in|zoom_out|crane|handheld|arc",
      "description": "Scene function / emotional beat: Public pressure, with the protagonist's first cold sign of future retaliation.\\nShot design:\\n0-2秒：，中景，固定镜头。Busy nurse station under cold fluorescent light, Lu Zhe adjusts his white coat.\\n2-5秒：，近景，缓慢推近。Lu Zhe smirks with cold confidence. Lu Zhe says: 'Wait and see.'\\n5-8秒：，中景，固定镜头。画外音（音色：male，around 30，steady tone，low-mid pitch，moderate pace，restrained，no accent）says: 'His gaze cuts through the crowd like a hidden blade.'\\nSound design:\\n- Footsteps, trolley wheels, and PA noise fill the background.\\n- Pull the ambient bed down just before the line lands.\\nDialogue rhythm:\\n- Leave a short half-beat pause before 'Wait and see.'\\nPerformance notes:\\n- Keep the coat-adjusting gesture small and controlled.\\n- Hold a contemptuous pause after the line instead of exiting immediately.",
      "setting": {
        "location": "Hospital - nurse station",
        "timeOfDay": "夜晚",
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
  zh: `你正在为”资产一致性场景视频”生成单张纯环境参考图。请直接生成图片，不要输出文字说明。

【项目画风】
{{style}}

【最终截图比例与全景约束】
{{aspectRatio}}

【场景标题】
{{sceneTitle}}

【环境摘要】
{{sceneDescription}}

【场景设定】
{{setting}}

【环境连续性要求】
{{environmentConsistency}}

【镜头与资产备注】
{{cameraNote}}

【执行要求】
1. 只生成 1 张环境资产图，不要拼图，不要分镜排版，不要多画面组合。
2. 这是一张纯环境全景源图：禁止出现人物、人脸、肢体、剪影、人群。
3. 仅依据环境摘要与场景设定提取地点、建筑、地形、道具、光照、天气与空间关系，不要把人物动作、对白、旁白转成画面主体。
4. 构图必须为“360 环绕等距柱状（equirectangular）全景展开图”语义：重点体现环绕空间关系，而非普通宽银幕构图。
5. 左右边缘应可自然衔接，避免断层；完整交代核心空间结构，并在主体空间四周预留足够环境信息，方便后续裁切不同截图区域。
6. 同一主环境的年代感、装修档次、材质语言、灯光体系必须和相邻场景保持一致。
7. 不要文字、水印、Logo、边框、界面元素。
8. 如果提供了二次生成要求，只做定向微调，不改变环境主体身份。

【二次生成补充要求】
{{customPrompt}}`,
  en: `You are generating a single pure environment reference image for an asset-consistent scene video workflow. Return the image directly, not text.

## Project Style
{{style}}

## Final Crop Ratio and Panorama Constraint
{{aspectRatio}}

## Scene Title
{{sceneTitle}}

## Environment Summary
{{sceneDescription}}

## Scene Setting
{{setting}}

## Environment Continuity Requirements
{{environmentConsistency}}

## Camera and Asset Notes
{{cameraNote}}

## Requirements
1. Generate exactly one environment asset image, not a collage, layout sheet, or split-panel composition.
2. This must be a pure panoramic environment source image: no humans, faces, body parts, silhouettes, or crowds.
3. Use only the environment summary and scene setting to extract location, architecture, terrain, props, lighting, weather, and spatial structure. Do not turn character action, dialogue, or narration into visual subjects.
4. Compose it as a 360 surround equirectangular panorama-style source frame, not a regular widescreen shot.
5. Keep left and right edges naturally seamable, fully explain the core space, and preserve enough surrounding detail for later reframing.
6. Keep era, renovation grade, material language, and lighting system consistent with neighboring scenes in the same root environment.
7. No text, watermark, logo, border, or UI elements.
8. If a regeneration note is provided, apply only targeted environment-level refinement without changing the core environment identity.

## Regeneration Note
{{customPrompt}}`
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
2. description 必须保持为“详细场景说明块”，不要退化成一句概述或普通散文。
3. 所有镜头、声音、台词节奏、表演提示都必须继续融合在 description 里，不要拆成额外 JSON 字段。
4. 优先沿用并强化这种结构：场景功能/情绪定位、镜头设计、声音设计、台词节奏、表演关键点。
5. 其中“镜头设计”至少包含 1 行时间轴，通常 2-6 行；每行格式：起始-结束秒：，景别，运镜方式。画面描述。旁白请用画外音格式嵌入。
6. 总时长参考约 {{durationHint}} 秒；如果是核心冲突戏，优先在同一 description 里做逐秒拆镜，而不是压缩成一句概述。
7. 必须融合用户本次修改意图，并保持剧情连续、角色身份一致、环境逻辑一致。
8. 若提到资产（角色/环境/道具），应体现在描述里，但不要输出 @mention 或 [引用资产] 区块。
9. 保留 [图片N] 标签风格；若原描述已有 [图片N]，优先沿用。
10. 不要输出“添加字幕/BGM/音效”等制作指令，但可以写叙事内声音设计，例如环境音、低频嗡鸣、玻璃碎声等。
11. 若原描述已具备明确结构，应在此基础上重写和补细，而不是删掉已有层次。`,
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
2. description must remain a detailed scene block, not a one-line summary and not plain prose.
3. Keep all shot, sound, dialogue-rhythm, and performance guidance inside description itself. Do not split them into extra JSON fields.
4. Prefer preserving and strengthening this structure: scene function / emotional beat, shot design, sound design, dialogue rhythm, performance notes.
5. Under shot design, include at least one timeline line and usually 2-6 lines. Each line must follow the format (use Chinese tokens exactly): start-end秒：，景别，运镜方式。Visual description.
6. The target duration is about {{durationHint}} seconds. For a major dramatic beat, expand detail inside the same description instead of collapsing it into summary prose.
7. Integrate the user's requested changes while preserving plot continuity, character identity, and environment logic.
8. If assets are mentioned, reflect them in the scene description, but do not output @mentions or asset-reference blocks.
9. Preserve the [ImageN] tag style. If existing tags are already present, reuse them whenever possible.
10. Do not output production instructions such as subtitles, BGM, or UI overlays, but narrative sound design is allowed.
11. If the source already has a clear structure, rewrite within that structure instead of flattening it.`
}

const SCENE_VIDEO_GENERATION_CONTENT: PromptTemplate['content'] = {
  zh: `直接生成一个单场景视频片段，不要输出文字，不要把以下内容理解成“要写提示词”。

【镜头编号】
{{shotNumber}}

【场景标题】
{{sceneTitle}}

【场景概要】
{{sceneSummary}}

【画风】
{{style}}

【时长】
约 {{duration}} 秒

【画幅】
{{aspectRatio}}

【场景设定】
{{setting}}

【场景详细说明】
{{sceneDescription}}

【必须遵循的时间轴镜头脚本】
{{timelineLines}}

【参考图说明】
{{referenceGuide}}

【参考素材】
{{referenceMaterials}}

【执行约束】
{{executionConstraints}}

【对白与旁白信息】
- 旁白：{{narration}}
- 对白：{{dialogues}}

【生成要求】
1. 严格按时间轴逐段推进，镜头衔接自然，不要把多段动作压缩成单一概述。
2. 如存在参考图，必须优先锁定角色身份、服装、发型、体态和环境空间关系。
3. 若场景详细说明里包含“声音设计、台词节奏、表演关键点”等内容，要把它们转成镜头节奏、人物动作、口型、呼吸感和情绪推进，不要把这些文字直接做成字幕或界面元素。
4. 动作演化要自然可信，避免角色漂移、空间跳变、物体凭空增减或镜头逻辑断裂。
5. 旁白和对白只体现在表演节奏、口型和画面情绪中，不要生成字幕、台词卡、UI 或水印。
6. 输出应是一个可直接使用的视频片段，风格统一，光照连续，构图清晰。`,
  en: `Generate a single-scene video clip directly. Do not return text, and do not treat the content below as instructions to write another prompt.

## Shot Number
{{shotNumber}}

## Scene Title
{{sceneTitle}}

## Scene Summary
{{sceneSummary}}

## Style
{{style}}

## Duration
About {{duration}} seconds

## Aspect Ratio
{{aspectRatio}}

## Scene Setting
{{setting}}

## Detailed Scene Description
{{sceneDescription}}

## Timeline Shot Script You Must Follow
{{timelineLines}}

## Reference Guide
{{referenceGuide}}

## Reference Materials
{{referenceMaterials}}

## Execution Constraints
{{executionConstraints}}

## Dialogue and Narration Context
- Narration: {{narration}}
- Dialogue: {{dialogues}}

## Generation Requirements
1. Follow the timeline beat by beat. Do not collapse multiple visual actions into a single generic summary.
2. If reference images are provided, lock character identity, outfit, hairstyle, posture, and environment spatial continuity first.
3. If the detailed scene description includes sound design, dialogue rhythm, or performance notes, translate them into pacing, acting, mouth movement, breath, and emotional progression. Do not render those words as subtitles or UI.
4. Motion should evolve naturally and consistently. Avoid identity drift, spatial jumps, disappearing or appearing key objects, or broken camera logic.
5. Reflect narration and dialogue through performance rhythm, mouth movement, and mood only. Do not generate subtitles, caption cards, UI, or watermarks.
6. The result must be a directly usable video clip with consistent style, lighting continuity, and clear composition.`
}
