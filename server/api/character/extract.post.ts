import { generateJSONForWorkflow } from '../../utils/workflow-model'
import { z } from 'zod'

/**
 * 角色提取请求
 */
const ExtractCharactersRequestSchema = z.object({
  content: z.string().describe('剧本或人物小传内容'),
  style: z.string().optional().default('国漫风格').describe('画风')
})

/**
 * 提取的角色信息
 */
const ExtractedCharacterSchema = z.object({
  role: z.string().describe('角色姓名'),
  role_content: z.string().describe('角色形象描述 (用于文生图)')
})

/**
 * 角色提取 API
 * POST /api/character/extract
 *
 * 基于飞书文档 2.4.1 的角色形象提取流程
 * 从剧本或人物小传中提取角色，生成文生图提示词
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  const body = await readBody(event)
  const parseResult = ExtractCharactersRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { content, style } = parseResult.data

  try {
    const systemInstruction = buildCharacterExtractSystemPrompt(style)
    const prompt = `请从以下内容中提取角色形象：\n\n${content}`

    // 使用业务流程配置的模型
    const result = await generateJSONForWorkflow<{ characters: Array<{ role: string, role_content: string }> }>('character_extraction', {
      prompt,
      systemInstruction,
      temperature: 0.4,
      maxRetries: 2
    })

    // 验证结果
    const characters = result.characters || []
    const validated = z.array(ExtractedCharacterSchema).safeParse(characters)

    if (!validated.success) {
      throw createError({
        statusCode: 500,
        statusMessage: '角色提取格式错误',
        message: validated.error.issues.map(i => `${i.path}: ${i.message}`).join(', ')
      })
    }

    return {
      success: true,
      characters: validated.data,
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    console.error('[CharacterExtract] 提取失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '角色提取失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})

/**
 * 角色提取系统提示词 (基于飞书文档 2.4.1)
 */
function buildCharacterExtractSystemPrompt(style: string): string {
  return `##角色
你是一名角色形象创作大师，请根据输入的信息提取角色形象，生成角色形象的描述和形象图片的生图提示词。

# 技能
1.首先识别输入内容中包含哪些角色
2.将剧本或人物小传中提到的角色抽取出来，生成角色形象的生图提示词。
- 角色姓名role：基于人物小传总结或基于剧本进行设计。
- 角色形象描述role_content：基于风格style、风格词库、人物小传、剧本等内容进行综合设计，必须包含人物风格描述、年龄、发型、脸型、衣服、裤子、鞋子、造型等，尽可能描述细节，不要用"这个""那个"指代，仅包含角色的全身形象描述，不涉及背景，200字以内。

#任务流程
1、识别输入内容中包含几个角色
2、理解内容中描述的角色的特征，生成角色特征的文生图提示词
3、按输出示例，逐个输出每个角色的文生图提示词

#输出格式
{
  "characters": [
    {
      "role": "小白",
      "role_content": "${style}，高精度日系清新元气少女，正面全身：浅粉齐肩碎发带呆毛，齐刘海，杏核浅棕眼 + 长睫毛 + 眼尾微圆，脸颊淡粉晕，软粉唇。穿白圆领 T 恤（左胸小草莓刺绣）+ 浅蓝针织短开衫（卷袖、扣中间扣），浅灰百褶裙（膝上、星星银线刺绣），白蕾丝袜 + 棕色圆头小皮鞋（鞋侧蝴蝶结）。脖子细银链挂小樱桃，右手串珠手链（粉白蓝）。站姿微踮脚，裙摆/发丝轻动，眼神亮如星，整体软萌清爽，细节精致不杂乱，主色粉/白/浅蓝，风格治愈。"
    }
  ]
}

## 限制:
- 输出内容必须围绕视频生成相关，拒绝回答无关话题。
- 严格按照给定的 json 格式进行输出，不能偏离框架要求。
- 需确保人物风格保持一致。
- 禁止输出暴力、血腥、政治等敏感词汇。提示词不要包含"血""警察""红色液体""民警"等词汇。
- 禁止把字幕或说话人文案放到画面上。
- 当前画风: ${style}`
}
