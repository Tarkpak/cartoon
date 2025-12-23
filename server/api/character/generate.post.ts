import { _geminiGenerateImage, ImageModels, GeminiError } from '../../utils/gemini'
import { imageLimiter, batchExecute } from '../../utils/concurrency'
import {
  GenerateCharacterRequestSchema,
  type CharacterAsset,
  type Character
} from '../../../shared/types/character'
import type { Emotion } from '../../../shared/types/script'

/**
 * 角色生成 API
 * POST /api/character/generate
 *
 * 使用 Nano Banana Pro 生成 4K 角色立绘，支持多表情变体
 */
export default defineEventHandler(async (event) => {
  const startTime = Date.now()

  // 1. 解析并验证请求
  const body = await readBody(event)
  const parseResult = GenerateCharacterRequestSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: '请求参数无效',
      message: parseResult.error.issues.map(i => i.message).join(', ')
    })
  }

  const { character, style, generateExpressions } = parseResult.data

  try {
    // 2. 生成基础立绘
    console.log(`[CharacterGen] 开始生成角色: ${character.name}`)
    const baseResult = await generateBaseImage(character, style)

    // 3. 生成表情变体
    let expressions: Partial<Record<Emotion, string>> = {}

    if (generateExpressions) {
      console.log(`[CharacterGen] 开始生成表情变体...`)
      expressions = await generateExpressionVariants(
        character,
        style,
        baseResult.imageData,
        baseResult.mimeType
      )
    }

    // 4. 构建资产对象
    const now = new Date().toISOString()
    const asset: CharacterAsset = {
      characterId: character.id,
      name: character.name,
      baseImage: baseResult.imageData,
      expressions: expressions as Record<Emotion, string>,
      createdAt: now,
      updatedAt: now
    }

    console.log(`[CharacterGen] 角色生成完成: ${character.name}, 耗时: ${Date.now() - startTime}ms`)

    return {
      success: true,
      asset,
      latencyMs: Date.now() - startTime
    }
  } catch (error) {
    console.error(`[CharacterGen] 生成失败:`, error)

    if (error instanceof GeminiError) {
      throw createError({
        statusCode: error.status || 500,
        statusMessage: `角色生成失败: ${error.code}`,
        message: error.message
      })
    }
    throw error
  }
})

/**
 * 生成基础立绘（使用并发控制）
 */
async function generateBaseImage(
  character: Character,
  style: string
): Promise<{ imageData: string, mimeType: string }> {
  const prompt = buildBaseImagePrompt(character, style)

  // 使用并发限制器控制请求
  const result = await imageLimiter.execute(() =>
    _geminiGenerateImage({
      model: ImageModels.HIGH_QUALITY,
      prompt,
      maxRetries: 2
    })
  )

  return {
    imageData: result.imageData,
    mimeType: result.mimeType
  }
}

/**
 * 生成表情变体（使用批量并发控制）
 */
async function generateExpressionVariants(
  character: Character,
  style: string,
  referenceImage: string,
  referenceMimeType: string
): Promise<Partial<Record<Emotion, string>>> {
  const emotions: Emotion[] = ['happy', 'sad', 'angry', 'surprised', 'neutral']
  const results: Partial<Record<Emotion, string>> = {}

  // 使用批量执行工具（带并发控制）
  const batchResult = await batchExecute({
    items: emotions,
    limiter: imageLimiter,
    continueOnError: true,
    processor: async (emotion) => {
      const prompt = buildExpressionPrompt(character, style, emotion)

      const result = await _geminiGenerateImage({
        model: ImageModels.HIGH_QUALITY,
        prompt,
        referenceImage: {
          data: referenceImage,
          mimeType: referenceMimeType
        },
        maxRetries: 1
      })

      return { emotion, imageData: result.imageData }
    },
    onProgress: (completed, total, result, error) => {
      if (error) {
        console.warn(`[CharacterGen] 表情生成失败 (${completed}/${total}):`, error.message)
      } else if (result) {
        console.log(`[CharacterGen] 表情生成完成: ${result.emotion} (${completed}/${total})`)
      }
    }
  })

  // 收集成功的结果
  for (const result of batchResult.results) {
    if (result) {
      results[result.emotion] = result.imageData
    }
  }

  console.log(`[CharacterGen] 表情生成统计: 成功 ${batchResult.successCount}, 失败 ${batchResult.errorCount}`)

  return results
}

/**
 * 从外观描述推断性别
 */
function inferGender(name: string, appearance: string): string {
  const text = `${name} ${appearance}`.toLowerCase()
  // 女性关键词
  if (/女|她|小姐|姑娘|女子|女孩|美女|少女|连衣裙|长裙|女性|妹|娘/.test(text)) {
    return '女性'
  }
  // 男性关键词
  if (/男|他|先生|男子|男孩|帅|少年|男性|哥|弟/.test(text)) {
    return '男性'
  }
  return '人物'
}

/**
 * 从外观描述推断年龄段
 */
function inferAgeRange(appearance: string): string {
  const text = appearance.toLowerCase()
  if (/幼|小孩|儿童|孩子/.test(text)) return '8-12岁'
  if (/少年|少女|学生|高中|初中/.test(text)) return '14-18岁'
  if (/青年|年轻|大学/.test(text)) return '20-28岁'
  if (/中年/.test(text)) return '35-50岁'
  if (/老|老人|老年/.test(text)) return '60岁以上'
  return '20-30岁' // 默认青年
}

/**
 * 构建基础立绘提示词
 */
function buildBaseImagePrompt(character: Character, style: string): string {
  // 自动推断性别和年龄
  const genderText = character.gender === 'male'
    ? '男性'
    : character.gender === 'female'
      ? '女性'
      : inferGender(character.name, character.appearance)

  const ageText = character.age
    ? `${character.age}岁`
    : inferAgeRange(character.appearance)

  return `创作一幅高质量的${style}风格角色立绘。

角色信息:
- 名称: ${character.name}
- 性别: ${genderText}
- 年龄: ${ageText}
- 外观特征: ${character.appearance}
${character.personality ? `- 性格气质: ${character.personality}` : ''}

要求:
1. 全身立绘，白色/透明背景
2. 角色面向镜头，表情自然中性
3. 高清 4K 质量，细节丰富
4. ${style}画风，色彩鲜明
5. 适合作为动漫/漫画角色
6. 姿态自然，双手可见`
}

/**
 * 构建表情变体提示词
 */
function buildExpressionPrompt(
  character: Character,
  style: string,
  emotion: Emotion
): string {
  const emotionDescriptions: Record<Emotion, string> = {
    neutral: '平静、冷静、自然的表情',
    happy: '开心、微笑、愉快的表情',
    sad: '悲伤、难过、忧郁的表情',
    angry: '愤怒、生气、不满的表情',
    surprised: '惊讶、震惊、意外的表情',
    confused: '困惑、疑惑、不解的表情',
    excited: '兴奋、激动、热情的表情',
    scared: '害怕、恐惧、紧张的表情',
    worried: '担忧、焦虑、不安的表情',
    concerned: '关切、担心、在意的表情',
    determined: '坚定、果断、决心的表情',
    thoughtful: '沉思、思考、若有所思的表情',
    nervous: '紧张、不安、局促的表情',
    relieved: '如释重负、放松的表情',
    hopeful: '充满希望、期待的表情',
    disappointed: '失望、沮丧、落寞的表情'
  }

  return `基于参考图中的角色，生成一个表情变体。

角色: ${character.name}
目标表情: ${emotionDescriptions[emotion]}

要求:
1. 保持角色外观、服装、发型完全一致
2. 只改变面部表情
3. 保持相同的姿态和角度
4. 保持相同的${style}画风
5. 背景保持白色/透明
6. 表情要明显但自然`
}
