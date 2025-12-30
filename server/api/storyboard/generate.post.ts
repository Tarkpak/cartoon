import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'
import {
  GenerateStoryboardRequestSchema,
  StoryboardSchema,
  type Storyboard
} from '../../../shared/types/storyboard'

/**
 * 分镜脚本生成 API
 * POST /api/storyboard/generate
 *
 * 基于飞书文档的分镜脚本创作流程，将场景描述转换为专业分镜脚本
 * 包含：镜号、景别、画面内容、台词、时长、运镜方式
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  const body = await readBody(event)
  const parseResult = GenerateStoryboardRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { sceneId, sceneDescription, dialogues, style } = parseResult.data

  try {
    // 从数据库获取提示词模板
    const promptContent = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.STORYBOARD_GENERATION,
      {
        sceneDescription,
        dialogues: dialogues ? JSON.stringify(dialogues) : '[]',
        style
      }
    )

    // 如果数据库没有配置，使用默认提示词
    const systemInstruction = promptContent?.systemPrompt || buildStoryboardSystemPrompt()
    const prompt = promptContent?.userPrompt || buildStoryboardPrompt(sceneDescription, dialogues, style)

    // 使用业务流程配置的模型
    let result = await generateJSONForWorkflow<Storyboard | Array<unknown>>('storyboard_generation', {
      prompt,
      systemInstruction,
      temperature: 0.3,
      maxRetries: 2
    })

    // 处理 AI 返回格式不一致的情况
    if (Array.isArray(result)) {
      // 检查数组第一个元素是否是完整的 Storyboard 对象
      const firstItem = result[0] as Record<string, unknown>
      if (firstItem && 'shots' in firstItem && Array.isArray(firstItem.shots)) {
        // AI 返回了 [Storyboard] 数组，取第一个元素
        console.log('[Storyboard] AI 返回了 Storyboard 数组，提取第一个元素')
        result = firstItem as Storyboard
      } else {
        // AI 直接返回了 shots 数组，需要包装成完整对象
        console.log('[Storyboard] AI 返回了 shots 数组，自动包装为对象')
        const shots = result as Array<{ duration?: number }>
        const totalDuration = shots.reduce((sum, shot) => sum + (shot.duration || 3), 0)
        result = {
          sceneId,
          shots: result,
          totalDuration
        } as Storyboard
      }
    }

    // 补充 sceneId（确保使用请求中的 sceneId）
    (result as Storyboard).sceneId = sceneId

    const validated = StoryboardSchema.safeParse(result)
    if (!validated.success) {
      console.error('[Storyboard] 验证失败，原始数据:', JSON.stringify(result).slice(0, 500))
      throw createError({
        statusCode: 500,
        statusMessage: '分镜脚本格式错误',
        message: validated.error.issues.map(i => `${i.path}: ${i.message}`).join(', ')
      })
    }

    return {
      success: true,
      data: validated.data,
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    console.error('[Storyboard] 生成失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '分镜脚本生成失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})

/**
 * 分镜脚本系统提示词 (基于飞书文档 2.3.1 优化版)
 */
function buildStoryboardSystemPrompt(): string {
  return `你是一位非常资深的分镜师，你的任务是根据输入的剧情内容，设计出合理、画面表现力丰富、运镜合理的分镜脚本。

## 核心任务

分镜脚本将用于生成 AI 动画视频，其中：
- **第一个镜头 (shots[0])** 的 visualContent 将用于生成场景的【首帧图片】
- **最后一个镜头 (shots[n-1])** 的 visualContent 将用于生成场景的【尾帧图片】
- 首帧和尾帧之间会通过 AI 视频生成技术进行插值，形成连贯的动画

因此，第一个和最后一个镜头的 visualContent 描述尤为重要，必须详细、具体、可视化。

## 输出要求

你必须输出有效的 JSON 格式：

{
  "sceneId": "场景ID",
  "sceneTitle": "场景标题",
  "shots": [
    {
      "shotNumber": 1,
      "shotType": "wide|medium|close|extreme_close|detail|extreme_wide|medium_wide|medium_close",
      "cameraMovement": "static|push|pull|pan_left|pan_right|track|dolly|zoom_in|zoom_out|tilt_up|tilt_down|crane|handheld|arc",
      "visualContent": "详细的画面内容描述（见下方要求）",
      "dialogue": "台词内容（可选，可为null）",
      "character": "说话角色（可选，可为null）",
      "emotion": "neutral|happy|sad|angry|surprised|confused|excited|scared|worried|concerned|determined|thoughtful|nervous|relieved|hopeful|disappointed",
      "duration": 3,
      "notes": "备注（可选，可为null）"
    }
  ],
  "totalDuration": 24
}

## visualContent 描述要求【重要】

visualContent 是用于 AI 图片生成的核心描述，必须包含：

1. **场景环境**：具体的地点、时间、光线、天气
2. **角色状态**：角色的位置、姿势、表情、动作
3. **构图说明**：画面的前景、中景、背景布局
4. **氛围细节**：色调、光影、情绪氛围

### visualContent 示例

示例1（首帧 - 建立场景）：
"温暖的咖啡厅内景，午后阳光透过落地窗洒入。画面中央，一位身穿白色衬衫的年轻女性坐在靠窗的位置，双手捧着咖啡杯，目光望向窗外，表情略带忧郁。背景是模糊的咖啡厅装饰和其他顾客。暖黄色调，柔和的侧逆光。"

示例2（中间镜头 - 对话）：
"咖啡厅双人座位，中景构图。左侧是白衬衫女性的侧脸，右侧是穿深蓝西装的男性正面，两人对视。男性表情认真，微微前倾。桌上放着两杯咖啡和一份文件。自然光从左侧窗户照入。"

示例3（尾帧 - 情绪转变）：
"同一咖啡厅场景，近景特写。白衬衫女性面带微笑，眼中含泪，双手紧握咖啡杯。阳光在她脸上形成温暖的光斑。背景虚化，突出人物情绪。整体色调从冷转暖，暗示希望。"

## 重要：emotion 字段只能使用以下值之一
- neutral (中性)
- happy (开心)
- sad (悲伤)
- angry (愤怒)
- surprised (惊讶)
- confused (困惑)
- excited (兴奋)
- scared (害怕)
- worried (担忧)
- concerned (关切)
- determined (坚定)
- thoughtful (沉思)
- nervous (紧张)
- relieved (释然)
- hopeful (希望)
- disappointed (失望)

如果角色情绪不明确，请使用 "neutral"。不要使用其他值如 tired, focused, anxious 等。

## 分镜设计原则

1. **首尾呼应**：第一个镜头建立场景，最后一个镜头体现情节发展或情绪变化
2. **角色一致性**：描述角色时要保持服装、发型等外观特征的一致性
3. **画面可生成**：visualContent 要具体到 AI 能够生成对应图片的程度
4. **动作连贯**：相邻镜头之间的角色动作要有逻辑连贯性
5. **节奏把控**：通过景别和时长变化控制叙事节奏

## 景别选择指南

- extreme_wide (大远景): 展示环境全貌，建立空间感，适合开场
- wide (全景): 展示人物全身与环境关系
- medium_wide (中全景): 展示人物膝盖以上
- medium (中景): 展示人物腰部以上，适合对话场景
- medium_close (中近景): 展示人物胸部以上
- close (近景): 展示人物肩部以上，强调表情
- extreme_close (特写): 展示面部细节，强调情绪高潮
- detail (细节特写): 展示特定物品或身体部位

## 运镜方式指南

- static (定镜): 固定镜头，适合对话或静态场景
- push (推镜头): 从远到近，强调主体或情绪升级
- pull (拉镜头): 从近到远，展示环境或情绪舒缓
- pan_left/pan_right (摇镜头): 水平移动，展示空间或跟随动作
- tilt_up/tilt_down (俯仰): 垂直移动镜头
- track (跟镜头): 跟随人物移动
- dolly (移镜头): 镜头整体移动，增加动感
- zoom_in/zoom_out (变焦): 快速聚焦或展开
- crane (升降): 垂直升降镜头
- handheld (手持): 手持晃动效果，增加紧张感
- arc (环绕): 环绕主体拍摄，增加戏剧性

## 完整分镜示例

场景：咖啡厅重逢

{
  "sceneId": "scene_001",
  "sceneTitle": "咖啡厅重逢",
  "shots": [
    {
      "shotNumber": 1,
      "shotType": "wide",
      "cameraMovement": "static",
      "visualContent": "温馨的咖啡厅全景，午后阳光透过落地窗洒入，形成温暖的光斑。靠窗位置，一位身穿白色衬衫、黑色长发的年轻女性独自坐着，手捧咖啡杯望向窗外。咖啡厅内有几位模糊的顾客，墙上挂着复古装饰画，角落有绿植。整体暖黄色调，氛围宁静略带期待。",
      "dialogue": null,
      "character": null,
      "emotion": "thoughtful",
      "duration": 3,
      "notes": "建立场景，展示女主等待的状态"
    },
    {
      "shotNumber": 2,
      "shotType": "medium",
      "cameraMovement": "static",
      "visualContent": "咖啡厅门口，一位穿深蓝色西装的年轻男性推门而入，逆光剪影。他的目光扫视店内，寻找着什么。门外是明亮的街道，形成强烈的明暗对比。",
      "dialogue": null,
      "character": null,
      "emotion": "neutral",
      "duration": 2,
      "notes": "男主登场"
    },
    {
      "shotNumber": 3,
      "shotType": "close",
      "cameraMovement": "push",
      "visualContent": "白衬衫女性的近景，她转头看向门口方向，眼睛微微睁大，嘴唇轻启，表情从平静转为惊讶。阳光照在她的侧脸上，形成柔和的轮廓光。背景虚化。",
      "dialogue": "是你...",
      "character": "林小雨",
      "emotion": "surprised",
      "duration": 2,
      "notes": "女主认出男主"
    },
    {
      "shotNumber": 4,
      "shotType": "medium",
      "cameraMovement": "static",
      "visualContent": "双人中景，深蓝西装男性走到桌前，与白衬衫女性对视。男性表情复杂，带着歉意和期待。两人之间的桌上放着一杯咖啡。光线从侧面照入，营造出戏剧性的氛围。",
      "dialogue": "好久不见，小雨。",
      "character": "陈默",
      "emotion": "nervous",
      "duration": 3,
      "notes": "重逢对话"
    },
    {
      "shotNumber": 5,
      "shotType": "extreme_close",
      "cameraMovement": "static",
      "visualContent": "女性面部特写，眼眶微红，嘴角却浮现出一丝微笑。泪光在眼中闪烁，但表情是释然的。柔和的侧光勾勒出她的轮廓，背景完全虚化成暖黄色光斑。",
      "dialogue": "三年了...",
      "character": "林小雨",
      "emotion": "relieved",
      "duration": 3,
      "notes": "情绪高潮，体现复杂情感"
    }
  ],
  "totalDuration": 13
}`
}

/**
 * 构建分镜提示词
 */
function buildStoryboardPrompt(
  sceneDescription: string,
  dialogues?: Array<{ character: string, text: string, emotion?: string }>,
  style?: string
): string {
  if (!style) {
    throw new Error('style 参数是必填的')
  }

  let prompt = `请为以下场景设计分镜脚本：

## 场景描述
${sceneDescription}

## 画风
${style}
`

  if (dialogues && dialogues.length > 0) {
    prompt += `
## 对话内容
${dialogues.map((d, i) => `${i + 1}. ${d.character}: "${d.text}" ${d.emotion ? `(${d.emotion})` : ''}`).join('\n')}
`
  }

  prompt += `
## 分镜要求

### 基本要求
1. 设计 3-6 个镜头，每个镜头时长 2-4 秒
2. 总时长控制在 10-20 秒
3. 合理安排景别变化，避免连续使用相同景别

### 首帧和尾帧【重要】
- **第一个镜头**：用于生成场景首帧，需要建立场景环境，visualContent 要包含完整的场景描述
- **最后一个镜头**：用于生成场景尾帧，需要体现情节发展或情绪变化，visualContent 要与首帧形成对比或呼应

### visualContent 描述要求
每个镜头的 visualContent 必须包含：
1. 场景环境（地点、光线、氛围）
2. 角色状态（位置、姿势、表情）
3. 构图说明（前景、中景、背景）
4. 色调和光影效果

### 角色描述一致性
- 描述角色时要明确服装颜色和款式（如"白色衬衫"、"深蓝西装"）
- 同一角色在不同镜头中的外观描述要保持一致
- 不要使用模糊的描述如"一个人"、"某人"

### 情绪和节奏
- 通过景别变化控制情绪节奏（远景→近景 = 情绪升级）
- 对话镜头建议使用 medium 或 close 景别
- 情绪高潮使用 extreme_close 特写`

  return prompt
}
