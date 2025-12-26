import { generateImage } from '../../utils/model-provider'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import { imageLimiter } from '../../utils/concurrency'
import {
  GenerateCharacterRequestSchema,
  type CharacterAsset,
  type Character
} from '../../../shared/types/character'

/**
 * 角色生成 API
 * POST /api/character/generate
 *
 * 生成角色设定图（Character Sheet），一张图包含：
 * - 三视图（正面、侧面、背面）
 * - 多种表情
 * - 服装/配饰细节
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
    // 生成角色设定图（一张图包含所有信息）
    console.log(`[CharacterGen] 开始生成角色设定图: ${character.name}`)
    const sheetResult = await generateCharacterSheet(character, style, generateExpressions)

    // 构建资产对象
    const now = new Date().toISOString()
    const asset: CharacterAsset = {
      characterId: character.id,
      name: character.name,
      baseImage: sheetResult.imageData, // 角色设定图作为基础图
      expressions: {}, // 表情已包含在设定图中
      createdAt: now,
      updatedAt: now
    }

    console.log(`[CharacterGen] 角色设定图生成完成: ${character.name}, 耗时: ${Date.now() - startTime}ms`)

    return {
      success: true,
      asset,
      sheetType: 'character-sheet', // 标识这是角色设定图
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
 * 生成角色设定图（Character Sheet）
 * 一张图包含三视图、表情、细节等所有信息
 */
async function generateCharacterSheet(
  character: Character,
  style: string,
  includeExpressions: boolean
): Promise<{ imageData: string, mimeType: string }> {
  const prompt = buildCharacterSheetPrompt(character, style, includeExpressions)

  const result = await imageLimiter.execute(() =>
    generateImage({
      prompt,
      maxRetries: 2
    })
  )

  // 处理千问返回的 URL 或 Gemini 返回的 base64
  if (result.imageUrl) {
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
 * 构建角色设定图提示词
 */
function buildCharacterSheetPrompt(
  character: Character,
  style: string,
  includeExpressions: boolean
): string {
  const genderText = character.gender === 'male'
    ? '男性'
    : character.gender === 'female'
      ? '女性'
      : inferGender(character.name, character.appearance)

  const ageText = character.age
    ? `${character.age}岁`
    : inferAgeRange(character.appearance)

  const visualFeatures = extractVisualFeatures(character.appearance)

  // 表情部分
  const expressionSection = includeExpressions
    ? `
## 表情展示（图片下方或右侧）
在设定图中包含 6 个头部特写表情：
1. 中性/平静 - 自然放松的表情
2. 开心/微笑 - 眼睛弯曲，嘴角上扬
3. 悲伤 - 眉头微皱，眼神低垂
4. 愤怒 - 眉头紧锁，眼神锐利
5. 惊讶 - 眼睛睁大，嘴巴微张
6. 害羞/脸红 - 微微低头，脸颊泛红

表情排列整齐，每个表情大小一致，清晰可辨。`
    : ''

  return `创作一张专业的${style}风格【角色设定图/Character Sheet】。

## 角色基本信息
- 名称: ${character.name}
- 性别: ${genderText}
- 年龄: ${ageText}
- 角色类型: ${character.role === 'protagonist' ? '主角' : character.role === 'antagonist' ? '反派' : '配角'}

## 外观特征（必须严格遵循）
${character.appearance}

## 关键视觉特征
${visualFeatures}

${character.personality ? `## 性格气质\n${character.personality}` : ''}

## 设定图布局要求

### 三视图（图片主体，占 60-70% 面积）
在同一张图中展示角色的三个视角，从左到右排列：
1. 【正面图】- 角色面向镜头，全身立绘
2. 【侧面图】- 角色侧身（左侧或右侧），全身立绘  
3. 【背面图】- 角色背对镜头，全身立绘

三个视角的角色必须：
- 保持完全相同的服装、发型、配饰、体型
- 保持相同的站姿高度和比例
- 清晰展示服装和发型在不同角度的样子
${expressionSection}

## 画风要求
- 风格: ${style}，专业角色设定图风格
- 画质: 高清，线条清晰，细节丰富
- 色彩: 鲜明饱和，便于参考

## 整体构图
- 纯白色或浅灰色背景
- 布局清晰整洁，像专业的游戏/动画角色设定
- 可以添加简单的标注线或分隔线
- 整体呈现为一张完整的角色参考图

## 禁止事项
- 不要添加复杂背景或场景
- 不要裁切角色任何部分
- 不要添加大段文字说明
- 三视图的角色外观必须完全一致
- 不要生成多个不同的角色`
}

/**
 * 从外观描述推断性别
 */
function inferGender(name: string, appearance: string): string {
  const text = `${name} ${appearance}`.toLowerCase()
  if (/女|她|小姐|姑娘|女子|女孩|美女|少女|连衣裙|长裙|女性|妹|娘/.test(text)) {
    return '女性'
  }
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
  return '20-30岁'
}

/**
 * 提取关键视觉特征
 */
function extractVisualFeatures(appearance: string): string {
  const features: string[] = []

  const hairMatch = appearance.match(/([黑白金银红蓝绿紫粉棕灰青橙]色?)?[的]?(长发|短发|中长发|马尾|双马尾|丸子头|披肩发|卷发|直发|波浪|刘海|齐刘海|斜刘海|碎发|寸头|平头|背头|辫子|麻花辫)/g)
  if (hairMatch) features.push(`发型: ${hairMatch.join('、')}`)

  const eyeMatch = appearance.match(/([黑蓝绿红金紫棕琥珀]色?)?[的]?(眼睛|眼眸|瞳孔|双眼)/g)
  if (eyeMatch) features.push(`眼睛: ${eyeMatch.join('、')}`)

  const clothMatch = appearance.match(/(校服|制服|西装|和服|汉服|连衣裙|衬衫|T恤|外套|大衣|风衣|夹克|卫衣|毛衣|裙子|短裙|长裙|裤子|牛仔裤|运动服|战斗服|铠甲|盔甲|斗篷|披风)/g)
  if (clothMatch) features.push(`服装: ${clothMatch.join('、')}`)

  const accessoryMatch = appearance.match(/(眼镜|耳环|项链|手表|手链|戒指|发带|发卡|帽子|围巾|领带|领结|蝴蝶结)/g)
  if (accessoryMatch) features.push(`配饰: ${accessoryMatch.join('、')}`)

  const bodyMatch = appearance.match(/(高挑|矮小|纤细|健壮|丰满|苗条|娇小|魁梧|修长)/g)
  if (bodyMatch) features.push(`体型: ${bodyMatch.join('、')}`)

  if (features.length === 0) {
    return '- 请根据角色描述自行设计合理的视觉特征'
  }

  return features.map(f => `- ${f}`).join('\n')
}
