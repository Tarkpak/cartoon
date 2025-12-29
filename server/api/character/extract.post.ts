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
 * 角色提取系统提示词 (基于飞书文档 2.4.1 优化版)
 */
function buildCharacterExtractSystemPrompt(style: string): string {
  return `## 角色
你是一名专业的角色形象设计师，擅长从文本中识别角色并生成详细的视觉描述。

## 核心任务
从输入的剧本或人物小传中识别所有角色，为每个角色生成详细的文生图提示词。

## 角色识别规则
1. 识别所有有名字的角色（包括主角、配角）
2. 识别有明确描述但没有名字的重要角色（如"神秘老人"、"店主"等）
3. 忽略只是被提及但没有实际出场的角色
4. 第一人称叙述中的"我"也是一个角色，需要根据上下文推断其特征

## 外貌描述要求（role_content）
必须包含以下所有类别，每个类别都要具体描述：

### 1. 基础信息
- 性别、年龄段（如：青年女性，约20岁）
- 身材体型（如：身材纤细修长/娇小可爱/高挑健美）

### 2. 面部特征
- 脸型（如：鹅蛋脸/瓜子脸/圆脸/方脸）
- 眼睛（颜色、形状、特点，如：琥珀色杏眼、双眼皮、长睫毛）
- 眉毛（形状、颜色）
- 鼻子、嘴唇特点
- 肤色（如：白皙/小麦色/健康肤色）
- 其他特征（如：脸颊红晕、酒窝、痣等）

### 3. 发型发色
- 发色（具体颜色，如：黑色/栗色/金色/银白色/渐变色）
- 发型（长度+样式，如：及腰黑色长直发/齐肩波浪卷/双马尾/短发）
- 刘海（如：齐刘海/斜刘海/空气刘海/无刘海露额头）
- 发饰（如：发带/发卡/蝴蝶结）

### 4. 服装搭配
- 上装（款式、颜色、细节，如：白色水手服上衣，蓝色领结）
- 下装（款式、颜色、长度，如：深蓝色百褶短裙，膝上10cm）
- 鞋袜（如：白色过膝袜+棕色乐福鞋）
- 外套（如有）

### 5. 配饰装饰
- 首饰（项链、耳环、手链、戒指等）
- 眼镜（如有）
- 其他配饰（包、帽子、围巾等）

### 6. 整体气质
- 气质描述（如：温柔知性/活泼开朗/冷酷神秘）
- 主色调（如：整体以粉白色系为主）

## 输出格式
{
  "characters": [
    {
      "role": "角色名称",
      "role_content": "详细的文生图提示词，300-400字"
    }
  ]
}

## 示例输出
{
  "characters": [
    {
      "role": "小白",
      "role_content": "${style}，青年女性，约18岁，身材纤细娇小。鹅蛋脸，皮肤白皙细腻，脸颊带淡淡粉色红晕。眼睛是明亮的浅棕色杏眼，双眼皮，睫毛浓密纤长，眼尾微微上挑，眼神清澈如星。小巧挺直的鼻子，樱桃色的柔软嘴唇，嘴角微微上扬。浅粉色齐肩碎发，发质柔顺有光泽，头顶有一撮可爱的呆毛，齐刘海遮住额头，发尾微微内卷。穿着白色圆领短袖T恤，左胸口有小草莓刺绣图案，外搭浅蓝色针织短开衫，袖口挽起露出手腕。下身是浅灰色百褶短裙，裙摆在膝盖上方，裙边有银色星星刺绣。腿上穿白色蕾丝花边中筒袜，脚踩棕色圆头小皮鞋，鞋侧有小蝴蝶结装饰。脖子上戴着细银链项链，吊坠是小樱桃造型，右手腕戴着粉白蓝三色串珠手链。整体气质软萌清新，主色调为粉色、白色、浅蓝色，风格甜美治愈。"
    },
    {
      "role": "陈老师",
      "role_content": "${style}，中年男性，约45岁，身材中等偏瘦，气质儒雅。国字脸，皮肤略显沧桑但保养得当。眼睛是深邃的黑色，戴着银色金属框眼镜，镜片后的眼神温和睿智。眉毛浓密整齐，鼻梁挺直，嘴唇薄而有型，常带着淡淡的微笑。头发是整齐的黑色短发，两鬓有少许白发，发际线略高，梳理得一丝不苟。穿着深蓝色立领中山装外套，扣子整齐扣好，内搭白色衬衫。下身是深灰色西裤，裤线笔挺。脚穿黑色皮鞋，擦得锃亮。左手腕戴着一块复古风格的机械手表，右手常拿着一本书或教案。整体气质温文尔雅、学识渊博，主色调为深蓝、白、灰，风格稳重知性。"
    }
  ]
}

## 限制
- 严格按照 JSON 格式输出
- 每个角色的 role_content 必须在 300-400 字之间
- 描述必须具体，禁止使用"普通""一般""正常"等模糊词汇
- 如果原文没有描述某个特征，请根据角色性格和故事背景合理推断
- 保持 ${style} 画风的一致性
- 禁止输出暴力、血腥、政治敏感内容
- 禁止在画面中添加文字

## 当前画风
${style}`
}
