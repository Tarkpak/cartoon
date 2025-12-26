import { generateJSONForWorkflow } from '../../utils/workflow-model'
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
    const systemInstruction = buildStoryboardSystemPrompt()
    const prompt = buildStoryboardPrompt(sceneDescription, dialogues, style)

    // 使用业务流程配置的模型
    const result = await generateJSONForWorkflow<Storyboard>('storyboard_generation', {
      prompt,
      systemInstruction,
      temperature: 0.3,
      maxRetries: 2
    })

    // 补充 sceneId
    result.sceneId = sceneId

    const validated = StoryboardSchema.safeParse(result)
    if (!validated.success) {
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
 * 分镜脚本系统提示词 (基于飞书文档 2.3.1)
 */
function buildStoryboardSystemPrompt(): string {
  return `你是一位非常资深的分镜师，你的任务是根据输入的剧情内容，设计出合理、画面表现力丰富、运镜合理的分镜脚本。

## 输出要求

你必须输出有效的 JSON 格式：

{
  "sceneId": "场景ID",
  "sceneTitle": "场景标题",
  "shots": [
    {
      "shotNumber": 1,
      "shotType": "wide|medium|close|extreme_close|detail",
      "cameraMovement": "static|push|pull|pan_left|pan_right|track|dolly|zoom_in|zoom_out",
      "visualContent": "详细的画面内容描述",
      "dialogue": "台词内容（可选）",
      "character": "说话角色（可选）",
      "emotion": "neutral|happy|sad|angry|surprised|confused|excited|scared",
      "duration": 3,
      "notes": "备注（可选）"
    }
  ],
  "totalDuration": 24
}

## 分镜设计原则

1. 分镜脚本应包含镜号、景别、画面内容、台词、时长、运镜方式等基本要素
2. 画面内容要紧密围绕剧情，能够准确地展现剧情的发展和情感变化
3. 景别和运镜方式的选择要合理，能够增强画面的表现力和节奏感
4. 台词要简洁明了，符合角色的性格和情境
5. 时长的安排要合理，能够保证剧情的流畅性和节奏感

## 景别选择指南

- extreme_wide (大远景): 展示环境全貌，建立空间感
- wide (全景): 展示人物全身与环境关系
- medium (中景): 展示人物膝盖以上，适合对话场景
- close (近景): 展示人物胸部以上，强调表情
- extreme_close (特写): 展示面部或物品细节，强调情绪
- detail (细节特写): 展示特定物品或身体部位

## 运镜方式指南

- static (定镜): 固定镜头，适合对话或静态场景
- push (推镜头): 从远到近，强调主体或情绪升级
- pull (拉镜头): 从近到远，展示环境或情绪舒缓
- pan_left/pan_right (摇镜头): 水平移动，展示空间或跟随动作
- track (跟镜头): 跟随人物移动
- dolly (移镜头): 镜头整体移动，增加动感
- zoom_in/zoom_out (变焦): 快速聚焦或展开`
}

/**
 * 构建分镜提示词
 */
function buildStoryboardPrompt(
  sceneDescription: string,
  dialogues?: Array<{ character: string, text: string, emotion?: string }>,
  style?: string
): string {
  let prompt = `请为以下场景设计分镜脚本：

## 场景描述
${sceneDescription}

## 画风
${style || '日式动漫'}
`

  if (dialogues && dialogues.length > 0) {
    prompt += `
## 对话内容
${dialogues.map((d, i) => `${i + 1}. ${d.character}: "${d.text}" ${d.emotion ? `(${d.emotion})` : ''}`).join('\n')}
`
  }

  prompt += `
## 要求
1. 每个镜头时长 1-5 秒，总时长控制在 20-40 秒
2. 合理安排景别变化，避免单调
3. 运镜方式要服务于叙事和情感表达
4. 画面内容描述要具体、可视化，便于 AI 图片生成
5. 确保镜头之间的连贯性和节奏感`

  return prompt
}
