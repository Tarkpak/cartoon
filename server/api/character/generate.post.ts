import { generateImage } from '../../utils/model-provider'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
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

    if (error instanceof GeminiError || error instanceof QwenError) {
      throw createError({
        statusCode: (error as GeminiError).status || 500,
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

  // 使用并发限制器控制请求，使用统一的 generateImage 函数
  const result = await imageLimiter.execute(() =>
    generateImage({
      prompt,
      maxRetries: 2
    })
  )

  // 处理千问返回的 URL 或 Gemini 返回的 base64
  if (result.imageUrl) {
    // 千问返回 URL，需要下载转换为 base64
    const response = await fetch(result.imageUrl)
    const buffer = await response.arrayBuffer()
    return {
      imageData: Buffer.from(buffer).toString('base64'),
      mimeType: 'image/png'
    }
  }

  return {
    imageData: result.imageData || '',
    mimeType: result.mimeType || 'image/png'
  }
}

/**
 * 生成表情变体（使用批量并发控制）
 * 注意：千问图片模型不支持参考图，表情变体功能仅在使用 Gemini 时可用
 */
async function generateExpressionVariants(
  character: Character,
  style: string,
  _referenceImage: string,
  _referenceMimeType: string
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

      // 使用统一的 generateImage 函数
      // 注意：千问不支持参考图，所以这里不传 referenceImage
      const result = await generateImage({
        prompt,
        maxRetries: 1
      })

      // 处理千问返回的 URL 或 Gemini 返回的 base64
      let imageData = result.imageData || ''
      if (result.imageUrl) {
        const response = await fetch(result.imageUrl)
        const buffer = await response.arrayBuffer()
        imageData = Buffer.from(buffer).toString('base64')
      }

      return { emotion, imageData }
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

  // 提取关键视觉特征
  const visualFeatures = extractVisualFeatures(character.appearance)

  return `创作一幅高质量的${style}风格角色立绘。

## 角色基本信息
- 名称: ${character.name}
- 性别: ${genderText}
- 年龄: ${ageText}
- 角色类型: ${character.role === 'protagonist' ? '主角' : character.role === 'antagonist' ? '反派' : '配角'}

## 外观特征（必须严格遵循）
${character.appearance}

## 关键视觉特征（必须体现）
${visualFeatures}

${character.personality ? `## 性格气质\n${character.personality}\n（通过表情、姿态、眼神体现性格）` : ''}

## 画风要求
- 风格: ${style}
- 画质: 高清 4K，细节丰富，线条清晰
- 色彩: 鲜明饱和，符合${style}风格

## 构图要求
1. 全身立绘，从头到脚完整呈现
2. 角色居中，占画面 70-80%
3. 纯白色背景，无任何装饰
4. 角色正面朝向镜头，略微侧身（约 15 度）增加立体感
5. 表情自然中性，眼神看向镜头
6. 姿态自然放松，双手可见
7. 光源从左上方 45 度照射，产生柔和阴影

## 禁止事项
- 不要添加任何背景元素
- 不要裁切角色任何部分
- 不要添加文字或水印
- 不要生成多个角色
- 不要改变指定的外观特征`
}

/**
 * 提取关键视觉特征
 */
function extractVisualFeatures(appearance: string): string {
  const features: string[] = []

  // 发型发色
  const hairMatch = appearance.match(/([黑白金银红蓝绿紫粉棕灰青橙]色?)?[的]?(长发|短发|中长发|马尾|双马尾|丸子头|披肩发|卷发|直发|波浪|刘海|齐刘海|斜刘海|碎发|寸头|平头|背头|辫子|麻花辫)/g)
  if (hairMatch) features.push(`发型: ${hairMatch.join('、')}`)

  // 眼睛
  const eyeMatch = appearance.match(/([黑蓝绿红金紫棕琥珀]色?)?[的]?(眼睛|眼眸|瞳孔|双眼)/g)
  if (eyeMatch) features.push(`眼睛: ${eyeMatch.join('、')}`)

  // 服装
  const clothMatch = appearance.match(/(校服|制服|西装|和服|汉服|连衣裙|衬衫|T恤|外套|大衣|风衣|夹克|卫衣|毛衣|裙子|短裙|长裙|裤子|牛仔裤|运动服|战斗服|铠甲|盔甲|斗篷|披风)/g)
  if (clothMatch) features.push(`服装: ${clothMatch.join('、')}`)

  // 配饰
  const accessoryMatch = appearance.match(/(眼镜|耳环|项链|手表|手链|戒指|发带|发卡|帽子|围巾|领带|领结|蝴蝶结)/g)
  if (accessoryMatch) features.push(`配饰: ${accessoryMatch.join('、')}`)

  // 体型
  const bodyMatch = appearance.match(/(高挑|矮小|纤细|健壮|丰满|苗条|娇小|魁梧|修长)/g)
  if (bodyMatch) features.push(`体型: ${bodyMatch.join('、')}`)

  if (features.length === 0) {
    return '- 请根据角色描述自行设计合理的视觉特征'
  }

  return features.map(f => `- ${f}`).join('\n')
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
