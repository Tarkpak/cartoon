/**
 * 当前工作台主流程默认提示词模板
 * 仅保留：解析 → 资产 → 视频
 */

import type { PromptTemplate } from '../../shared/types/prompt-template'
import { getPromptTemplateMetadataForWorkflow } from '../../shared/types/prompt-template'

function getBasePromptTemplates(): PromptTemplate[] {
  const now = new Date().toISOString()
  const metadataList = getPromptTemplateMetadataForWorkflow()

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

export function getDefaultPromptTemplates(): PromptTemplate[] {
  return getBasePromptTemplates().map(template => ({
    ...template,
    content: getSeedanceOptimizedContent(template.id, template.content),
    isCustomized: false
  }))
}

export function getSeedanceOptimizedPromptTemplates(
  _workflow?: unknown
): PromptTemplate[] {
  return getDefaultPromptTemplates()
}

function getSeedanceOptimizedContent(
  id: string,
  base: PromptTemplate['content']
): PromptTemplate['content'] {
  switch (id) {
    case 'script_parsing':
      return applySeedanceScriptParsing(base)
    case 'script_parsing_short_drama':
      return applySeedanceScriptParsing(base)
    case 'character_sheet':
      return applySeedanceCharacterSheet(base)
    case 'character_regeneration':
      return applySeedanceCharacterRegeneration(base)
    case 'environment_reference_generation':
      return applySeedanceEnvironmentReference(base)
    case 'scene_description_refinement':
      return applySeedanceSceneRefinement(base)
    case 'scene_video_generation':
      return applySeedanceSceneVideo(base)
    default:
      return base
  }
}

function appendRulesAfterLine(
  content: string,
  anchor: string,
  rules: string[]
): string {
  if (!rules.length) return content
  if (!content.includes(anchor)) return content
  return content.replace(anchor, `${anchor}\n${rules.join('\n')}`)
}

function getDefaultContent(id: string): PromptTemplate['content'] {
  switch (id) {
    case 'script_parsing':
      return SCRIPT_PARSING_CONTENT
    case 'script_parsing_short_drama':
      return SCRIPT_PARSING_SHORT_DRAMA_CONTENT
    case 'script_episode_plan':
      return SCRIPT_EPISODE_PLAN_CONTENT
    case 'script_parsing_segment_context':
      return SCRIPT_PARSING_SEGMENT_CONTEXT_CONTENT
    case 'script_parsing_episode_drama_context':
      return SCRIPT_PARSING_EPISODE_DRAMA_CONTEXT_CONTENT
    case 'character_sheet':
      return CHARACTER_SHEET_CONTENT
    case 'character_regeneration':
      return CHARACTER_REGENERATION_CONTENT
    case 'environment_reference_generation':
      return ENVIRONMENT_REFERENCE_GENERATION_CONTENT
    case 'environment_reference_negative_prompt':
      return ENVIRONMENT_REFERENCE_NEGATIVE_PROMPT_CONTENT
    case 'prop_asset_generation':
      return PROP_ASSET_GENERATION_CONTENT
    case 'prop_asset_negative_prompt':
      return PROP_ASSET_NEGATIVE_PROMPT_CONTENT
    case 'scene_description_refinement':
      return SCENE_DESCRIPTION_REFINEMENT_CONTENT
    case 'scene_video_generation':
      return SCENE_VIDEO_GENERATION_CONTENT
    default:
      return '请完成任务。'
  }
}

const SCRIPT_PARSING_CONTENT: PromptTemplate['content'] = `你是一位资深分镜师，负责把输入剧本忠实还原为可执行分镜。请把输入文本解析成可直接进入”资产准备 → 分镜视频生成”的结构化数据。

【输入文本】
{{novelText}}

【项目画风】
{{style}}

【时代推断提示】
{{eraHint}}

【输入规模】
- 文本长度：约 {{textLength}} 字
- 场景数量：默认不设固定值，由模型根据剧情承载自行决定；如外部传入提示值，仅作弱参考
- 单场时长范围：{{sceneDurationMin}}-{{sceneDurationMax}} 秒
- 解析模式：{{scriptParseModeLabel}}

【解析模式策略（必须执行）】
{{scriptParseModeRules}}

【核心目标】
1. 必须覆盖原文完整主线，不得省略关键事件、关键情绪转折和关键旁白。
2. 输出结果必须直接服务当前工作台主流程：后续要生成角色资产、环境参考图和分镜视频。
3. 每个场景都要足够“可拍”，描述应体现环境、角色、动作、镜头重点和关键道具。

【分集规划补充消费规则（必须执行）】
1. 系统可能追加“本集规划补充”（含爆点与资产锚点）。若存在，必须在本集输出中显式消费，不得忽略。
2. 若补充中提供了角色资产锚点（姓名、gender、外观基线），characters 顶层数组与 scene.characters 的命名必须优先沿用，且角色外观基线保持一致，不得漂移。
3. 若补充中提供了道具锚点，相关场景 description 中应体现这些关键道具的存在与功能，不得全部丢失或替换成泛词。
4. 若补充中提供了环境锚点（location/timeOfDay），scene.setting.location 与 scene.setting.timeOfDay 优先沿用锚点命名；同一主环境跨场景保持一致命名。
5. 冲突优先级：原文明确事实 > 本集规划补充 > 模型自行补充。允许做最小必要补全，但禁止臆造关键资产。

【场景拆分规则】
1. 当地点变化、时间跳跃、动作阶段变化、情绪明显转折、叙事视角切换时，必须拆分新场景。
2. 同一地点、同一时间、同一连续戏剧动作内，如果只是镜头切换、视角切换、表情推进、台词递进，不要拆场景，应在 description 内做逐秒拆镜。
3. 只有当“场景功能”发生变化时再拆场景，例如：开场钩子、矛盾升级、反击转折、结尾宣言。
4. 场景数量由模型根据剧情承载自行决定；如外部传入场景数提示，仅作弱参考，不作为硬限制。
5. 每个场景的 duration 必须是数字，且在 {{sceneDurationMin}}-{{sceneDurationMax}} 秒之间。
6. totalDuration 必须严格等于所有 scenes[i].duration 的总和。

【场景字段规则】
1. scenes[i].shotType 只能是：extreme_wide、wide、medium_wide、medium、medium_close、close、extreme_close、detail。
2. scenes[i].cameraMovement 只能是：static、push、pull、pan_left、pan_right、tilt_up、tilt_down、track、dolly、zoom_in、zoom_out、crane、handheld、arc、whip_pan、dutch_tilt、roll。选择最能代表该场景主运镜方式的值。
3. scenes[i].environmentCaptureMode 只能是：single、four_view。若本场存在明确多视角/多机位/镜头切换，必须用 four_view；单一连续视角用 single。
4. scenes[i].setting.timeOfDay 只能是：黎明、早晨、白天、中午、下午、傍晚、夜晚。
5. scenes[i].setting.era 只能是：古代、民国、现代、近未来、架空。若原文不明确且画风包含 AI真人/live action，默认使用“现代”。
6. scenes[i].setting.location 请优先使用”主环境-子空间”或”主环境/子空间”的中性命名。
7. 同一主环境在不同子空间中必须保持一致的建筑年代、装修档次、材质语言和维护状态。
8. 除非原文明确说明新旧分区或废弃区，禁止输出互相冲突的环境风格。
9. scenes[i].usePreviousLastFrameAsFirstFrame 用于判断是否建议“用上一镜头末帧作为本镜头首帧参考”：第一场必须为 false；同一分集内地点/时间/人物/动作连续、无硬切/闪回/蒙太奇/大幅时间跳跃时可为 true；地点切换、时间跳跃、闪回、蒙太奇、新段落或新分集必须为 false。
10. scenes[i].continuityLinkReason 仅在 usePreviousLastFrameAsFirstFrame 为 true 时填写一句简短原因，否则留空字符串。

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
5. 时长要以剧情表达完整为优先。若同一戏剧段超过单场可生成时长，请拆成连续场景承接，不得删减关键剧情与情绪推进。
6. 对话要直接写在对应镜头行中，用单引号包裹，例如：陆哲说：'你们等着看。'
7. 旁白/画外音必须嵌入对应镜头行中，格式：画外音（音色：性别，年龄段，语调描述，音高，语速，情绪，口音）说：'旁白内容'。
示例：画外音（音色：男性，30岁左右，语调平静而富有叙事感，音高中等，语速适中，情绪内敛，无口音）说：'那份冰冷的文件，像一把钝刀。'
8. “声音设计”里写环境音、关键音效、语气和节奏；“表演关键点”里写眼神、停顿、微表情、手部动作、身体重心变化等。
9. 每行应包含丰富的镜头语言：光线描写、空间关系、人物动作细节、环境氛围与声音描写。
10. description 中禁止写"添加字幕/BGM/音效"等制作指令，但可以写“环境音/低频嗡鸣/玻璃碎声”等叙事内声音设计。
11. 不要自行生成任何 @图片N（旧格式 [图片N] 也禁止）或其他引用编号；如系统后续需要引用标签，会由后处理统一注入。
12. 若镜头能透过门、窗、玻璃看到相邻子空间，必须明确写出可见空间的灯光、主色调、门窗位置与关键陈设，并在对应子空间场景中沿用，不得把同一主环境写成两套布景。
13. 禁止使用“氛围感、电影感、好看点”等抽象词，统一改为可执行的镜头与动作描述。
14. 每行镜头建议按“主体定义 + 连续动作 + 景别 + 运镜 + 光影 + 约束”顺序组织。
15. 涉及后续图生视频的场景，需在描述中体现“与参考图主体一致，不修改核心设定”的约束语义。
16. 运镜不要堆砌，每行最多 1-2 种运镜语义；动作速度优先缓慢、匀速、平稳。
17. 若场景存在招牌、屏幕、墙面文字等风险，需明确写“避免生成无关文字/字幕”。

【角色与旁白规则】
1. 只识别真实角色，不要把旁白、画外音、系统说明、音效、抽象概念当作角色。
2. 场景中的旁白、画外音、内心独白必须同时输出到 scenes[i].narration 字段，并以画外音格式嵌入 description 的对应时间轴行中。
3. dialogues 仅保留真实角色台词，不要把“旁白”写成角色。
4. characters 数组中的角色描述要稳定可复用，便于后续角色资产生成，角色描述要具体。
5. 对每个场景，明确角色、环境和关键道具等资产需求，但不要额外新增无关元素。

【角色资产沿用约束 (characters)】
1. 角色资产主定义来自分集目录 episodeAssets.characters（系统补充给出时）。本任务必须优先沿用角色命名、gender 与外观基线，不得另起一套设定。
2. characters 描述应保持“静态可复用”：禁止写当前场景动作、情绪、临时道具；动态信息只写在 scenes[i].description。
3. 若补充未覆盖某角色，可做最小必要补全（年龄段、发型、五官、常服），但不得与原文事实或已有锚点冲突。
4. 同一角色在整个 JSON 中必须保持一致，不得随场景漂移；若发生冲突，以原文明确事实优先，其次沿用补充锚点。

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
"cameraMovement": "static|push|pull|pan_left|pan_right|tilt_up|tilt_down|track|dolly|zoom_in|zoom_out|crane|handheld|arc|whip_pan|dutch_tilt|roll",
"environmentCaptureMode": "single|four_view",
"description": "场景功能/情绪定位：公开压迫，主角第一次显出反击前的冷感。\\n镜头设计：\\n0-2秒：中景，固定镜头。护士站走廊白炽灯映出冷硬的墙面，人来人往，陆哲抬手整理白大褂，动作从容。\\n2-5秒：近景，缓慢推近。陆哲嘴角上扬，眼神中透着志在必得的冷傲。陆哲说：'你们等着看。'\\n5-8秒：中景，固定镜头。画外音（音色：男性，30岁左右，语调沉稳，音高偏低，语速适中，情绪克制，无口音）说：'他的目光穿过人群，像一把隐忍的刀。'\\n声音设计：\\n- 环境音以护士站脚步声、推车轮声和广播底噪为主。\\n- 陆哲开口前压低环境声，让台词更顶。\\n台词节奏：\\n- '你们等着看。'前短停半拍，后半句咬字更重。\\n表演关键点：\\n- 整理白大褂时手势克制而笃定。\\n- 说完台词后不要立刻转身，留一个带轻蔑意味的停顿。",
"setting": {
"location": "医院-护士站",
"timeOfDay": "夜晚",
"era": "现代",
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
"usePreviousLastFrameAsFirstFrame": false,
"continuityLinkReason": "",
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

只输出 JSON，不要附加解释。`

const SCRIPT_PARSING_SHORT_DRAMA_CONTENT: PromptTemplate['content'] = `你是一位短剧分镜编排导演。请把输入文本解析为可直接用于“资产准备 → 分镜视频生成”的高节奏结构化 JSON，并在完整覆盖原文主线的前提下执行短剧节奏锚点。

【输入文本】
{{novelText}}

【项目画风】
{{style}}

【时代推断提示】
{{eraHint}}

【输入规模】
- 文本长度：约 {{textLength}} 字
- 场景数量：默认不设固定值，由模型根据剧情承载自行决定；如外部传入提示值，仅作弱参考
- 单场时长范围：{{sceneDurationMin}}-{{sceneDurationMax}} 秒

【剧情覆盖硬约束（必须执行）】
1. 必须按原文叙事顺序覆盖主线，不得跳段、并段后造成因果断裂。
2. 禁止把整篇剧情压缩成单段 60 秒结构；节奏骨架仅用于“每个关键剧情段”的内部节奏组织。
3. 文本较长时，通过增加场景数量承载内容，不得删减关键事件、情绪反转和关键旁白。

【短剧节奏骨架（按剧情段循环应用，不是整篇压缩上限）】
时段 | 秒数 | 情绪曲线 | 功能
开场钩子 | 0-8s | 震惊→冰冷 | 抓住注意力
矛盾升级 | 9-25s | 心痛→绝望 | 建立共情
虚伪交锋 | 26-42s | 厌倦→决绝 | 形成转折
结尾宣言 | 43-60s | 空洞→冷厉 | 留悬念/期待

【核心节奏逻辑（必须同构落地）】
1. 每个关键剧情段前 3 秒尽快落冲突动作/道具，立即起钩子。
2. 关键剧情段前中段（约 20%-60%）要有情感重击，形成共情。
3. 关键剧情段后中段（约 55%-80%）要有“觉醒信号”（如手不再抖、眼神稳定、动作决绝）。
4. 关键剧情段尾部（最后 10%-20%）给出冷感宣言或反击预告。
5. 若原文不是离婚题材，映射同等级冲突，不丢失节奏锚点。

【短剧戏剧强度硬约束】
1. 每个场景必须先完成 dramatic 字段，再依据 dramatic 写 description；禁止只写环境走位和普通对话。
2. 每个场景必须回答：谁在压迫谁、观众为什么生气、主角失去或被威胁什么、反击/反转在哪里、最后 2 秒为什么想追下一场。
3. 每个场景都要有“情绪落差”或“权力关系变化”：羞辱→冷静、威胁→反杀、误解→揭露、嘲笑→打脸、暧昧试探→明牌撑腰等。
4. description 开头必须保留以下段落，且内容要具体，不得空泛：
   戏剧冲突：
   爽点/痛点：
   情绪曲线：
   反击或反转：
   结尾钩子：
5. 若原文某段本身平淡，允许在不改变核心事件和人物立场的前提下强化外显冲突：增加压迫性动作、旁观者反应、停顿、眼神、冷感反问、反派破防表现。

【改编原则】
1. 忠于原文核心关系与关键事件，不得改写人物立场。
2. 文本很长时，不要只截取爆点；应通过增加场景完整覆盖主线因果链。
3. 场景拆分围绕戏剧功能变化，同时保证前后场景可串联。
4. 保持原文事件顺序，禁止把后文反转提前到前文场景。

【分集规划补充消费规则（必须执行）】
1. 系统可能追加“本集规划补充”（含爆点与资产锚点）。若存在，必须在本集输出中显式消费，不得忽略。
2. 若补充中提供了角色资产锚点（姓名、gender、外观基线），characters 顶层数组与 scene.characters 的命名必须优先沿用，且角色外观基线保持一致，不得漂移。
3. 若补充中提供了道具锚点，相关场景 description 中应体现这些关键道具的存在与功能，不得全部丢失或替换成泛词。
4. 若补充中提供了环境锚点（location/timeOfDay），scene.setting.location 与 scene.setting.timeOfDay 优先沿用锚点命名；同一主环境跨场景保持一致命名。
5. 冲突优先级：原文明确事实 > 本集规划补充 > 模型自行补充。允许做最小必要补全，但禁止臆造关键资产。

【场景拆分规则】
1. 总场景数由模型根据剧情承载自行决定；如外部传入场景数提示，仅作弱参考，不作为硬限制。
2. 地点、时间、动作目标、情绪方向、叙事视角、戏剧功能任一变化时必须拆场。
3. 每场 duration 必须为数字，且在 {{sceneDurationMin}}-{{sceneDurationMax}} 秒。
4. totalDuration 必须严格等于 scenes[i].duration 之和。
5. 同一时空连续动作中，仅镜头切换/表情推进/台词递进时不拆场，但必须在 description 逐秒覆盖，不得跳过原文关键信息。

【场景字段硬约束】
1. scenes[i].shotType 只能是：extreme_wide、wide、medium_wide、medium、medium_close、close、extreme_close、detail。
2. scenes[i].cameraMovement 只能是：static、push、pull、pan_left、pan_right、tilt_up、tilt_down、track、dolly、zoom_in、zoom_out、crane、handheld、arc。
3. scenes[i].environmentCaptureMode 只能是：single、four_view。若本场存在明确多视角/多机位/镜头切换，必须用 four_view；单一连续视角用 single。
4. scenes[i].setting.timeOfDay 只能是：黎明、早晨、白天、中午、下午、傍晚、夜晚。
5. scenes[i].setting.era 只能是：古代、民国、现代、近未来、架空。若原文不明确且画风包含 AI真人/live action，默认使用“现代”。
6. scenes[i].usePreviousLastFrameAsFirstFrame 用于判断是否建议“用上一镜头末帧作为本镜头首帧参考”：第一场必须为 false；同一分集内地点/时间/人物/动作连续、无硬切/闪回/蒙太奇/大幅时间跳跃时可为 true；地点切换、时间跳跃、闪回、蒙太奇、新段落或新分集必须为 false。
7. scenes[i].continuityLinkReason 仅在 usePreviousLastFrameAsFirstFrame 为 true 时填写一句简短原因，否则留空字符串。

【description 写作规则】
1. 必须是“可拍摄”的时间轴分镜块，禁止一句话概述。
2. 每个场景至少 2 行镜头设计，建议 3-6 行，时间从 0 秒起。
3. 镜头行格式：起始-结束秒：，景别，运镜方式。画面动作与对白。
4. 对白写在镜头行，用单引号；旁白写成：画外音（音色：...）说：'...'
5. 必须包含“声音设计/台词节奏/表演关键点”，突出停顿、眼神、手部动作和压迫感。
6. 禁止输出 @图片N（旧格式 [图片N] 也禁止）、字幕指令、BGM指令等后期制作命令。

【角色规则】
1. 只识别真实角色，不要把旁白/音效当角色。
2. narration 字段仅放旁白/画外音；dialogues 仅放真实角色台词。
3. characters 顶层数组要给出稳定可复用的角色描述，便于后续角色资产生成。

【角色资产沿用约束 (characters)】
1. 角色资产主定义来自分集目录 episodeAssets.characters（系统补充给出时）。本任务必须优先沿用角色命名、gender 与外观基线，不得另起一套设定。
2. characters 描述应保持“静态可复用”：禁止写当前场景动作、情绪、临时道具；动态信息只写在 scenes[i].description。
3. 若补充未覆盖某角色，可做最小必要补全（年龄段、发型、五官、常服），但不得与原文事实或已有锚点冲突。
4. 同一角色在整个 JSON 中必须保持一致，不得随场景漂移；若发生冲突，以原文明确事实优先，其次沿用补充锚点。

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
"environmentCaptureMode": "single|four_view",
"dramatic": {
  "function": "hook|escalation|confrontation|reversal|payoff|cliffhanger|aftermath",
  "conflict": "本场核心冲突：谁压迫谁、争夺什么",
  "emotionalCurve": "羞辱→震惊→冷感反击",
  "audienceHook": "观众继续看的理由",
  "painPoint": "观众共情或愤怒的痛点",
  "payoff": "本场爽点/回报点",
  "powerShift": "权力关系如何变化",
  "antagonistPressure": "反派如何施压",
  "protagonistCounter": "主角如何反击或埋下反击",
  "cliffhanger": "结尾钩子或下一场期待"
},
"description": "场景功能/情绪定位：开场钩子，冲突强压。\\n镜头设计：\\n0-2秒：，中景，固定镜头。离婚协议被推到桌面中央，纸张边缘刮过手背。\\n2-5秒：，近景，缓慢推近。女儿盯着男主，冷声补刀：'你早该签了。'\\n5-8秒：，特写镜头，固定镜头。男主眼神发冷，手指停在签字处。\\n声音设计：\\n- 纸张摩擦声与椅脚拖地声前置。\\n台词节奏：\\n- '你早该签了。'中段停顿半拍。\\n表演关键点：\\n- 签字前手部细颤，随后逐步稳定。",
"setting": {
"location": "客厅-餐桌区",
"timeOfDay": "夜晚",
"era": "现代",
"mood": "压迫",
"weather": "雨夜（可选）"
},
"characters": [
{
"name": "角色名",
"appearance": "外观描述",
"emotion": "neutral|happy|sad|angry|surprised|scared|worried|determined"
}
],
"dialogues": [
{
"character": "角色名",
"text": "台词",
"emotion": "determined"
}
],
"narration": "旁白/画外音（可选）",
"usePreviousLastFrameAsFirstFrame": false,
"continuityLinkReason": "",
"duration": 8
}
],
"characters": [
{
"name": "角色名",
"description": "角色整体外貌描述",
"role": "protagonist|antagonist|supporting",
"gender": "male|female|other"
}
],
"totalDuration": 96
}
\`\`\`

只输出 JSON，不要附加解释。`

const SCRIPT_EPISODE_PLAN_CONTENT: PromptTemplate['content'] = `你是专业短剧编剧统筹，请把一部长文本剧本按“剧情结构 + 爆点节奏”拆分成分集目录。

要求：
1) 必须按剧情节点分集，不允许按字数平均切分。
2) {{modeRule}}
3) {{chunkRule}}
4) 每集给出 title（可简短），并给出 startAnchor：
   - startAnchor 必须是原文中的连续原句片段，逐字摘录，不得改写。
   - {{firstAnchorRule}}
   - 第2集及以后 startAnchor 必须对应该集开头附近，建议 20~80 字，尽量唯一。
5) 每集必须明确“观众为什么上头”：开场钩子、压迫/羞辱、反击/反转、情绪曲线、结尾钩子。不是离婚/复仇题材时，也要映射成同等级冲突和期待。
6) 每集标题优先使用爆点式命名，例如“第3集：真话符打白莲”“第12集：赐婚反噬”，避免只写地点或流水账。
7) payoffType 必须从以下类型中选择最贴近的一项：打脸、反杀、揭露、甜宠撑腰、身世反转、危机升级、搞钱逆袭、权力升级。
8) episodeAssets.characters 是全流程角色资产主定义（后续解析任务必须沿用）。description 必须面向角色图生成，写成完整外观基线，而不是身份摘要或剧情关系。
9) 角色资产描述严格规范（必须执行）：
   - 全局稳定性：同一角色在所有分集中 description 必须一致，不得随剧情漂移。
   - 剥离动态：禁止写动作、表情、情绪、临时道具（如“正在流泪”“手持匕首”）；只写静态外观特征。
   - 去文学化：禁止“气质冷傲”“倾国倾城”等抽象词，改为可视化物理特征。
   - 强制维度：优先覆盖 性别呈现/年龄段、脸型五官、发型发色、身形体态、常穿服装、关键配饰、必须保持不变的视觉锚点。
10) episodeAssets.characters[].gender 必须为 male、female、other 之一；根据原文称谓、代词、姓名、亲属关系、身份词和外貌线索推断，原文已暗示男/女时不得留空或反转。
11) episodeAssets.props 要写“后续可生成参考图”的道具，不要只写泛词（如“道具”）；优先写可识别名词，并补充外观材质/关键细节/剧情功能（如：婚戒、病历袋、录音笔、家法藤条）。
12) episodeAssets.environments 的 location 优先使用“主环境-子空间”或“主环境/子空间”，timeOfDay 能确定时必须填写；同一主环境跨分集要保持命名一致，不要一会儿“豪宅客厅”一会儿“别墅大厅”指同一空间。
13) 资产列表要“少而关键”，只保留对角色资产、环境图和分镜推进有用的项；不确定时可留空，禁止臆造。
14) 仅输出 JSON，不要 markdown，不要解释文本，不要输出空集。

JSON 结构（严格遵守）：
{
  "episodes": [
    {
      "index": 1,
      "title": "第1集：...",
      "startAnchor": "原文片段",
      "episodeHook": "开场3秒内出现的强钩子动作/台词/道具",
      "humiliationOrThreat": "本集最强压迫、羞辱或危机",
      "reversalPoint": "主角反击、证据出现、靠山登场或局势反转",
      "emotionalCurve": "震惊→憋屈→愤怒→冷感反击",
      "cliffhanger": "本集最后2-5秒的追看钩子",
      "payoffType": "打脸",
      "episodeAssets": {
        "characters": [{ "name": "角色名", "description": "完整外观基线", "role": "protagonist|antagonist|supporting", "gender": "male|female|other" }],
        "props": [{ "name": "道具名", "description": "可选" }],
        "environments": [{ "location": "地点", "timeOfDay": "可选", "mood": "可选" }]
      }
    }
  ]
}

原文如下：
{{novelText}}`

const SCRIPT_PARSING_SEGMENT_CONTEXT_CONTENT: PromptTemplate['content'] = `{{basePrompt}}

【分段解析上下文（系统追加）】
- 当前仅处理原文第 {{chunkIndex}}/{{chunkCount}} 段，禁止补写未提供段落。
- 本段文本长度：约 {{chunkLength}} 字（全量占比约 {{chunkPercentage}}%）。
- 输出仍需保持原文顺序；若与前段重叠，请避免重复同一场景。`

const SCRIPT_PARSING_EPISODE_DRAMA_CONTEXT_CONTENT: PromptTemplate['content'] = `{{basePrompt}}

【本集规划补充（系统追加，必须落入 dramatic / description / asset 相关字段）】
{{episodeDramaBrief}}

执行约束：
1) 若补充里含“资产锚点”，必须优先沿用锚点中的角色命名、外观基线、关键道具与环境命名。
2) 输出 JSON 时，确保这些锚点在 characters/scenes.setting/description 中可追踪，不得被泛化或遗漏。
3) 若锚点与原文明确事实冲突，以原文明确事实为准，并采用最小改动修正。`

const CHARACTER_SHEET_CONTENT: PromptTemplate['content'] = `为 {{characterName}} 创建一张 {{style}} 风格的角色资产设定板。

角色外貌基线：
{{appearance}}

性别呈现约束：
{{gender}}

执行要求：
1. 输出必须是单角色角色资产图，不要输出文字说明。
2. 16:9 横版构图，纯白或浅灰背景，适合后续作为角色一致性参考。
3. 左侧为脸部近景，右侧为 正面 / 侧面 / 背面 三视图全身站姿。
4. 三视图必须等比例、等身高、等服装结构，对齐清晰。
5. 严格遵守性别呈现约束，不得把男性画成女性化角色，也不得把女性画成男性化角色。
6. 严格依据角色外貌描述，避免任意添加新设定。
7. 若模型接收到参考图，必须优先保持身份一致：脸型、五官、发型、服装、配饰不可漂移。
8. 画面干净、结构清晰、细节稳定，不要戏剧化背景，不要多人同框，不要水印和 Logo。`

const CHARACTER_REGENERATION_CONTENT: PromptTemplate['content'] = `你正在执行“角色资产二次生成”任务，请直接生成修改后的角色图片，不要输出文字解释。

角色信息：
- 名称：{{characterName}}
- 外貌基线：{{appearance}}
- 性别呈现：{{gender}}
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
5. 构图稳定、主体清晰、光影自然，避免过饱和、过锐化和塑料质感。`

const ENVIRONMENT_REFERENCE_GENERATION_CONTENT: PromptTemplate['content'] = `你正在为分镜视频生成单张纯环境参考图。请直接生成图片，不要输出文字说明。

【项目画风】
{{style}}

【全景源图规格】
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
4. 构图必须是标准 360 环境贴图：2:1 equirectangular projection / spherical panorama / HDRI environment map source。它不是普通相机拍摄的宽银幕照片，也不是单方向透视图。
5. 左右边缘必须能无缝衔接；完整交代前后左右四个方向的空间结构，并在核心空间四周保留足够环境信息，方便后续从任意方向裁切截图。
6. 视点位于空间中心附近，使用自然水平视线；避免主体空间贴近视点、贴脸前景、巨大近处遮挡或单面墙占满画面，保证裁切任意方向时仍能读出整体空间。
7. 同一主环境的年代感、装修档次、材质语言、灯光体系必须和相邻场景保持一致。
8. 不要文字、水印、Logo、边框、界面元素。
9. 不要生成 fisheye lens photo、普通超广角照片、倾斜地平线或弯曲建筑结构；允许 equirectangular 投影本身的贴图展开特征，但不要把它画成鱼眼圆形图或单镜头广角照。
10. 若门窗、玻璃或敞开通道中能看到相邻空间，不要把它处理成模糊光块；要交代相邻空间的结构轮廓、灯光和关键陈设，并与同一主环境下的对应子空间保持一致。
11. 如果提供了二次生成要求，只做定向微调，不改变环境主体身份。

【二次生成补充要求】
{{customPrompt}}`

const ENVIRONMENT_REFERENCE_NEGATIVE_PROMPT_CONTENT: PromptTemplate['content'] = '人物, 角色, 人脸, 人体, 手, 剪影, 人群, human, person, people, face, portrait, character, body, hands, crowd, watermark, logo, text, 鱼眼, 透视畸变, 桶形畸变, 枕形畸变, 边缘拉伸, 夸张广角畸变, fisheye, fish-eye, lens distortion, barrel distortion, pincushion distortion, warped lines, curved horizon, extreme perspective, distorted ultra-wide lens'

const PROP_ASSET_GENERATION_CONTENT: PromptTemplate['content'] = `你正在为分镜视频生成单张{{assetLabel}}参考图。请直接生成图片，不要输出文字说明。

【项目画风】
{{style}}

【资产名称】
{{assetName}}

【资产描述】
{{assetDescription}}

【执行要求】
1. 只生成 1 张{{assetLabel}}参考图，不要拼图，不要多画面组合。
2. 画面主体必须是该资产本身，完整展示外形、材质、颜色、尺度和关键细节。
3. 使用干净中性背景或透明感背景，不要生成复杂场景，不要让环境喧宾夺主。
4. 禁止出现人物、人脸、手、身体部位、文字、水印、Logo、边框、界面元素。
5. 避免把资产画成多个不同版本；如果需要展示细节，也必须保持同一个资产身份。
6. 构图稳定，主体居中且完整，不裁切，不遮挡，适合作为后续视频生成参考图。`

const PROP_ASSET_NEGATIVE_PROMPT_CONTENT: PromptTemplate['content'] = '人物, 人脸, 人体, 手, 多个不同物体版本, 文字, 水印, logo, UI, human, person, face, hands, text, watermark'

const SCENE_DESCRIPTION_REFINEMENT_CONTENT: PromptTemplate['content'] = `你是一名资深影视场景编辑，负责根据用户指令改写当前场景描述。请严格输出 JSON：
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
5. 其中“镜头设计”至少包含 1 行时间轴，通常 2-6 行；每行格式：起始-结束秒：景别，运镜方式。画面描述。旁白请用画外音格式嵌入。
6. 总时长参考约 {{durationHint}} 秒；如果是核心冲突戏，优先在同一 description 里做逐秒拆镜，而不是压缩成一句概述。
7. 必须融合用户本次修改意图，并保持剧情连续、角色身份一致、环境逻辑一致。
8. 若提到资产（角色/环境/道具），应体现在描述里，但不要输出 @mention 或 [引用资产] 区块。
9. 统一使用 @图片N 标签；若原描述含旧格式 [图片N]，请改写为 @图片N 并保持引用稳定。
10. 不要输出“添加字幕/BGM/音效”等制作指令，但可以写叙事内声音设计，例如环境音、低频嗡鸣、玻璃碎声等。
11. 若原描述已具备明确结构，应在此基础上重写和补细，而不是删掉已有层次。
12. 若镜头能透过门、窗、玻璃看到另一空间，必须把门窗朝向、可见空间的灯光、主色调和关键陈设写清楚，方便后续切到该空间时保持一致。`

const SCENE_VIDEO_GENERATION_CONTENT: PromptTemplate['content'] = `直接生成一个分镜片段，不要输出文字，不要把以下内容理解成“要写提示词”。

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

【参考图说明】
{{referenceGuide}}

【参考素材】
{{referenceMaterials}}

【执行约束】
{{executionConstraints}}

【旁白信息】
- 旁白：{{narration}}

【对白信息】
{{dialogues}}

【生成要求】
1. 严格按场景详细说明中的时序逐段推进，镜头衔接自然，不要把多段动作压缩成单一概述。
2. 如存在参考图，必须优先锁定角色身份、服装、发型、体态和环境空间关系。
3. 若场景详细说明里包含“声音设计、台词节奏、表演关键点”等内容，要把它们转成镜头节奏、人物动作、口型、呼吸感和情绪推进，不要把这些文字直接做成字幕或界面元素。
4. 动作演化要自然可信，避免角色漂移、空间跳变、物体凭空增减或镜头逻辑断裂。
5. 旁白和对白只体现在表演节奏、口型和画面情绪中，不要生成字幕、台词卡、UI 或水印。
6. 若镜头透过门、窗、玻璃看到相邻空间，必须让该可见空间与对应内景/外景镜头共享同一建筑结构、门窗朝向、灯光颜色、主色调和关键陈设。
7. 如果前一镜头已经拍到某个室内或室外子空间，切到该空间时必须延续已出现的布景，不得重新发明另一套陈设。
8. 输出应是一个可直接使用的视频片段，风格统一，光照连续，构图清晰。
9. 严禁生成背景音乐（BGM/配乐）；仅保留叙事内环境音与动作特效音，并与画面节奏一致。`

function applySeedanceScriptParsing(content: string): string {
  return appendRulesAfterLine(
    content,
    '12. 若镜头能透过门、窗、玻璃看到相邻子空间，必须明确写出可见空间的灯光、主色调、门窗位置与关键陈设，并在对应子空间场景中沿用，不得把同一主环境写成两套布景。',
    [
      '13. 禁止使用“氛围感、电影感、好看点”等抽象词，统一改为可执行的镜头与动作描述。',
      '14. 每行镜头建议按“主体定义 + 连续动作 + 景别 + 运镜 + 光影 + 约束”顺序组织。',
      '15. 涉及后续图生视频的场景，需在描述中体现“与参考图主体一致，不修改核心设定”的约束语义。',
      '16. 运镜不要堆砌，每行最多 1-2 种运镜语义；动作速度优先缓慢、匀速、平稳。',
      '17. 若场景存在招牌、屏幕、墙面文字等风险，需明确写“避免生成无关文字/字幕”。'
    ]
  )
}
function applySeedanceCharacterSheet(content: string): string {
  return appendRulesAfterLine(
    content,
    '8. 画面干净、结构清晰、细节稳定，不要戏剧化背景，不要多人同框，不要水印和 Logo。',
    [
      '9. 主体描述需明确年龄段、性别呈现、脸型特征、发型、服装结构和状态，不使用“漂亮/帅气/精致”等抽象词。',
      '10. 风格锚点控制在 1-2 个核心词，避免混合冲突风格。',
      '11. 强化稳定性约束：面部清晰、五官比例自然、性别呈现稳定、服装一致、无双胞胎、无肢体畸形、无字幕水印。'
    ]
  )
}
function applySeedanceCharacterRegeneration(content: string): string {
  return appendRulesAfterLine(
    content,
    '5. 构图稳定、主体清晰、光影自然，避免过饱和、过锐化和塑料质感。',
    [
      '6. 执行顺序固定为“先锁定身份，再执行改动”，身份一致性优先级高于风格变化。',
      '7. 改动描述必须具体到“部位 + 变化方向 + 幅度 + 保留项”，避免模糊改写指令。',
      '8. 增加负面约束：无变脸、无双胞胎、无穿模、无字幕。'
    ]
  )
}
function applySeedanceEnvironmentReference(content: string): string {
  return appendRulesAfterLine(
    content,
    '11. 如果提供了二次生成要求，只做定向微调，不改变环境主体身份。',
    [
      '12. 环境描述必须具体到时间、天气、光线方向、主光颜色、关键材质和反射关系。',
      '13. 禁止“神秘、高级、有感觉”等主观词，直接描述空间结构与可见细节。',
      '14. 增加文字控制：避免生成任何无关字符、字幕和 Logo。',
      '15. 若存在可见相邻空间，明确门窗朝向、可见区域色温与关键道具，保证后续切镜一致。'
    ]
  )
}
function applySeedanceSceneRefinement(content: string): string {
  return appendRulesAfterLine(
    content,
    '12. 若镜头能透过门、窗、玻璃看到另一空间，必须把门窗朝向、可见空间的灯光、主色调和关键陈设写清楚，方便后续切到该空间时保持一致。',
    [
      '13. 改写结果必须保持可执行的分镜时间序列，不得退化为无法落地的整段散文。',
      '14. 每行镜头尽量包含主体、动作速度、景别、运镜和约束，减少模型随机性。',
      '15. 若存在引用标签，统一使用 @图片N；若出现旧格式 [图片N]，改写为 @图片N 并保持主体命名稳定，避免角色指代漂移。',
      '16. 对关键冲突镜头补充稳定性约束：面部清晰、动作连贯、画面稳定、无跳帧、无畸形、无字幕。'
    ]
  )
}
function applySeedanceSceneVideo(content: string): string {
  return appendRulesAfterLine(
    content,
    '9. 严禁生成背景音乐（BGM/配乐）；仅保留叙事内环境音与动作特效音，并与画面节奏一致。',
    [
      '10. 严格保持“全局设定 + 镜头1..N”的时序，不得丢镜头或跳过中间动作段。',
      '11. 每个镜头优先采用 1 种景别 + 1 种主运镜；若组合运镜，最多 2 种。',
      '12. 动作节奏优先缓慢或匀速，除非脚本明确要求激烈动作。',
      '13. 若有参考图，必须严格保持主体身份与核心设定一致，不偏离脸型、发型和服装结构。',
      '14. 强化稳定性与负面约束：画面稳定、无变脸、无肢体畸形、无穿模、无跳帧、无字幕、无水印。',
      '15. 对白与旁白仅体现在口型和表演节奏，不生成任何屏幕文字。'
    ]
  )
}
