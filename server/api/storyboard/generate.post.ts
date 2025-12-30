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
    // 从数据库获取提示词模板（已合并系统提示词和用户提示词）
    const prompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.STORYBOARD_GENERATION,
      {
        sceneDescription,
        dialogues: dialogues ? JSON.stringify(dialogues) : '[]',
        style
      }
    ) || buildStoryboardPrompt(sceneDescription, dialogues, style)

    // 不再需要单独的系统提示词
    const systemInstruction = undefined

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
 * 构建分镜提示词（备用默认值）
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
