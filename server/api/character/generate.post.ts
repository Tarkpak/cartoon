import { generateImage } from '../../utils/model-provider'
import { GeminiError } from '../../utils/gemini'
import { QwenError } from '../../utils/qwen'
import { VolcengineError } from '../../utils/volcengine'
import { imageLimiter } from '../../utils/concurrency'
import { getWorkflowModels } from '../models/workflow.get'
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
      sheetType: 'full', // 角色设定图类型
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

    // 处理各种 AI 服务商的错误
    if (error instanceof GeminiError || error instanceof QwenError || error instanceof VolcengineError) {
      // 解析错误信息，提供更友好的提示
      let userMessage = error.message
      const errorCode = String((error as GeminiError).code || 'UNKNOWN')
      
      // 敏感内容检测错误
      if (error.message.includes('sensitive') || errorCode.includes('Sensitive')) {
        userMessage = '输入内容可能包含敏感信息，请修改角色描述后重试'
      }
      // 配额/限流错误
      else if (errorCode === 'RESOURCE_EXHAUSTED' || error.message.includes('quota') || error.message.includes('rate limit')) {
        userMessage = 'API 调用次数已达上限，请稍后重试'
      }
      // 模型不可用
      else if (errorCode === 'UNAVAILABLE' || error.message.includes('unavailable')) {
        userMessage = 'AI 服务暂时不可用，请稍后重试'
      }

      throw createError({
        statusCode: (error as GeminiError).status || 500,
        statusMessage: `角色生成失败`,
        message: userMessage
      })
    }
    
    // 其他未知错误
    throw createError({
      statusCode: 500,
      statusMessage: '角色生成失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
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

  // 从工作流配置获取角色立绘生成模型
  const workflowModels = await getWorkflowModels()
  const modelId = workflowModels.character_portrait
  console.log(`[CharacterGen] 使用图片模型: ${modelId}`)

  const result = await imageLimiter.execute(() =>
    generateImage({
      modelId,
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
 * 构建角色设定图提示词（优化版）
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

  // 解析并增强外貌特征
  const enhancedFeatures = enhanceVisualFeatures(character.appearance, style)

  // 表情部分
  const expressionSection = includeExpressions
    ? `
## 表情展示（图片下方或右侧，排成一行或两行）
在设定图中包含 6 个头部特写表情圆形小图：
1. 😐 中性/平静 - 自然放松，眼神平和
2. 😊 开心/微笑 - 眼睛弯成月牙，嘴角上扬露出笑容
3. 😢 悲伤 - 眉头微皱下垂，眼角下垂，嘴角向下
4. 😠 愤怒 - 眉头紧锁，眼神锐利，嘴唇紧抿
5. 😲 惊讶 - 眼睛睁大，眉毛上扬，嘴巴微张成O型
6. 😳 害羞 - 微微低头侧脸，脸颊泛红，眼神躲闪

表情要求：
- 每个表情大小一致，清晰可辨
- 保持角色的发型、发色、眼睛颜色完全一致
- 表情夸张生动，符合${style}风格的表现手法`
    : ''

  return `创作一张专业的【${style}风格角色设定图 / Character Design Sheet】。

## 核心要求
这是一张用于动画/漫画制作的角色参考图，必须：
1. 清晰展示角色的完整外貌特征
2. 保证三视图中角色外观100%一致
3. 适合作为后续创作的视觉参考

## 角色基本信息
- 名称: ${character.name}
- 性别: ${genderText}
- 年龄: ${ageText}
- 角色定位: ${character.role === 'protagonist' ? '主角（需要最精细的设计）' : character.role === 'antagonist' ? '反派（需要突出特点）' : '配角'}

## 外貌特征描述【必须严格遵循】
${character.appearance}

## 视觉特征清单【逐项检查】
${enhancedFeatures}

${character.personality ? `## 性格气质（影响表情和姿态）\n${character.personality}` : ''}

## 设定图布局

### 主体：三视图（占画面 65-75%）
从左到右水平排列三个全身立绘：

【左】正面图 (Front View)
- 角色正面面向镜头
- 双手自然下垂或轻放身侧
- 展示服装正面所有细节
- 面部表情为中性/微笑

【中】3/4侧面图 (3/4 View)
- 角色身体转向约45度
- 展示脸部轮廓和侧面发型
- 展示服装的立体感和层次

【右】背面图 (Back View)
- 角色背对镜头
- 展示发型背面和服装背部细节
- 可微微侧头展示侧脸轮廓
${expressionSection}

## 画面规格
- 画布比例: 16:9 横向（适合展示三视图+表情）
- 背景: 纯白色或浅灰色渐变，无任何装饰
- 画质: 高清，线条清晰锐利，色彩饱和
- 风格: ${style}，专业角色设定图风格

## 构图要求
- 三个视角的角色等高，头顶和脚底对齐
- 角色之间保持适当间距，不重叠
- 可添加简洁的分隔线或标注线
- 整体布局整洁专业，像游戏/动画的官方设定

## 绝对禁止
❌ 复杂背景或场景元素
❌ 裁切角色任何身体部位
❌ 三视图中角色外观不一致（发型、服装、配饰必须完全相同）
❌ 添加大段文字说明或对话框
❌ 生成多个不同的角色
❌ 过于复杂的姿势或动作`
}

/**
 * 增强视觉特征提取（优化版）
 * 从外观描述中提取并结构化视觉特征，如果缺失则提供默认建议
 */
function enhanceVisualFeatures(appearance: string, style: string): string {
  const features: string[] = []
  const text = appearance

  // 1. 发型发色
  const hairColorMatch = text.match(/([黑白金银红蓝绿紫粉棕灰青橙栗茶亚麻蜜糖酒红樱花渐变彩虹]+)色?[的]?[头发发丝]/g)
  const hairStyleMatch = text.match(/(长发|短发|中长发|马尾|双马尾|单马尾|高马尾|低马尾|丸子头|双丸子|披肩发|卷发|直发|波浪|大波浪|微卷|内扣|外翻|刘海|齐刘海|斜刘海|空气刘海|八字刘海|碎发|寸头|平头|背头|油头|辫子|麻花辫|双辫|编发|盘发|公主切|姬发式|狼尾|鲻鱼头|及腰|及肩|齐耳|超短)/g)

  if (hairColorMatch || hairStyleMatch) {
    const hairDesc = [hairColorMatch?.join('、'), hairStyleMatch?.join('、')].filter(Boolean).join('，')
    features.push(`✓ 发型发色: ${hairDesc}`)
  } else {
    features.push(`⚠ 发型发色: 未明确指定，请根据角色气质设计合适的发型`)
  }

  // 2. 眼睛
  const eyeMatch = text.match(/([黑蓝绿红金紫棕琥珀翠绿宝石深邃明亮清澈]+)色?[的]?(眼睛|眼眸|瞳孔|双眼|眼瞳)/g)
  const eyeShapeMatch = text.match(/(杏眼|丹凤眼|桃花眼|狐狸眼|圆眼|细长眼|大眼|双眼皮|单眼皮|内双|长睫毛|浓眉|柳叶眉|剑眉|一字眉)/g)

  if (eyeMatch || eyeShapeMatch) {
    const eyeDesc = [eyeMatch?.join('、'), eyeShapeMatch?.join('、')].filter(Boolean).join('，')
    features.push(`✓ 眼睛特征: ${eyeDesc}`)
  } else {
    features.push(`⚠ 眼睛特征: 未明确指定，请设计符合${style}风格的眼睛`)
  }

  // 3. 脸型肤色
  const faceMatch = text.match(/(鹅蛋脸|瓜子脸|圆脸|方脸|国字脸|心形脸|菱形脸|长脸|娃娃脸|巴掌脸)/g)
  const skinMatch = text.match(/(白皙|小麦色|健康肤色|苍白|红润|古铜色|蜜色|奶白|瓷白)/g)

  if (faceMatch || skinMatch) {
    const faceDesc = [faceMatch?.join('、'), skinMatch?.join('、')].filter(Boolean).join('，')
    features.push(`✓ 脸型肤色: ${faceDesc}`)
  } else {
    features.push(`⚠ 脸型肤色: 未明确指定`)
  }

  // 4. 服装
  const topMatch = text.match(/(校服|制服|西装|和服|汉服|旗袍|连衣裙|衬衫|T恤|卫衣|毛衣|针织衫|外套|大衣|风衣|夹克|皮衣|运动服|水手服|JK|洛丽塔|哥特|朋克|休闲装|正装|礼服|婚纱|战斗服|铠甲|盔甲|斗篷|披风|长袍|道袍|僧袍|巫师袍)/g)
  const bottomMatch = text.match(/(裙子|短裙|长裙|百褶裙|A字裙|包臀裙|蓬蓬裙|裤子|牛仔裤|西裤|运动裤|短裤|热裤|阔腿裤|紧身裤|打底裤)/g)
  const shoeMatch = text.match(/(皮鞋|运动鞋|高跟鞋|平底鞋|靴子|长靴|短靴|凉鞋|拖鞋|帆布鞋|板鞋|乐福鞋|玛丽珍|厚底鞋)/g)

  if (topMatch || bottomMatch || shoeMatch) {
    const clothDesc = [
      topMatch ? `上装: ${topMatch.join('、')}` : null,
      bottomMatch ? `下装: ${bottomMatch.join('、')}` : null,
      shoeMatch ? `鞋子: ${shoeMatch.join('、')}` : null
    ].filter(Boolean).join('；')
    features.push(`✓ 服装搭配: ${clothDesc}`)
  } else {
    features.push(`⚠ 服装搭配: 未明确指定，请设计符合角色身份和故事背景的服装`)
  }

  // 5. 配饰
  const accessoryMatch = text.match(/(眼镜|墨镜|耳环|耳钉|项链|吊坠|手表|手链|手镯|戒指|发带|发卡|发夹|蝴蝶结|头饰|发箍|帽子|围巾|领带|领结|领巾|胸针|徽章|腰带|背包|挎包|手提包)/g)

  if (accessoryMatch) {
    features.push(`✓ 配饰装饰: ${accessoryMatch.join('、')}`)
  } else {
    features.push(`○ 配饰装饰: 无特殊配饰或未指定`)
  }

  // 6. 体型
  const bodyMatch = text.match(/(高挑|矮小|纤细|健壮|丰满|苗条|娇小|魁梧|修长|匀称|壮硕|瘦弱|圆润|结实|纤瘦|微胖)/g)

  if (bodyMatch) {
    features.push(`✓ 身材体型: ${bodyMatch.join('、')}`)
  } else {
    features.push(`⚠ 身材体型: 未明确指定`)
  }

  // 7. 特殊标记
  const specialMatch = text.match(/(疤痕|胎记|纹身|刺青|痣|雀斑|酒窝|虎牙|尖耳|兽耳|猫耳|狐耳|翅膀|尾巴|角|光环|机械臂|义眼)/g)

  if (specialMatch) {
    features.push(`✓ 特殊标记: ${specialMatch.join('、')}`)
  }

  // 8. 整体气质
  const temperamentMatch = text.match(/(温柔|冷酷|活泼|开朗|内向|高冷|傲娇|腹黑|天然呆|元气|阳光|忧郁|神秘|优雅|知性|可爱|帅气|英俊|美丽|清纯|妩媚|妖艳|干练|成熟|稳重|儒雅|霸气|狂野)/g)

  if (temperamentMatch) {
    features.push(`✓ 整体气质: ${temperamentMatch.join('、')}`)
  }

  // 9. 主色调
  const colorMatch = text.match(/主色[调系]?[为是：:]+([^，。,\.]+)/g)
  if (colorMatch) {
    features.push(`✓ 主色调: ${colorMatch.join('、').replace(/主色[调系]?[为是：:]+/g, '')}`)
  }

  if (features.length === 0) {
    return `⚠ 外貌描述较为简略，请根据以下要点自行设计：
- 发型发色：选择符合${style}风格的发型
- 眼睛特征：设计有特点的眼睛颜色和形状
- 脸型肤色：选择合适的脸型
- 服装搭配：设计符合角色身份的服装
- 整体气质：体现角色性格的视觉表现`
  }

  return features.join('\n')
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
