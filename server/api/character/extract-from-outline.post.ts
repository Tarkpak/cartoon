import { z } from 'zod'
import { generateJSON, getSelectedModels } from '../../utils/model-provider'
import { getInterpolatedPrompt } from '../../utils/prompt-template'
import { PROMPT_TEMPLATE_IDS } from '../../../shared/types/prompt-template'

const RequestSchema = z.object({
  outline: z.object({
    title: z.string(),
    synopsis: z.string(),
    acts: z.array(z.object({
      summary: z.string(),
      keyEvents: z.array(z.string())
    })),
    suggestedCharacters: z.array(z.object({
      name: z.string(),
      role: z.string(),
      description: z.string(),
      personality: z.string().optional(),
      motivation: z.string().optional()
    })).optional()
  }),
  style: z.string().describe('画风 (必填，由项目配置决定)'),
  // 新增：从场景中提取的角色名称列表，用于增强角色信息
  existingCharacters: z.array(z.string()).optional()
})

const CharacterSchema = z.object({
  name: z.string(),
  role: z.enum(['protagonist', 'antagonist', 'supporting']),
  appearance: z.string(),
  personality: z.string(),
  traits: z.array(z.string()),
  background: z.string().optional(),
  motivation: z.string().optional(),
  speakingStyle: z.enum(['formal', 'casual', 'polite', 'rude', 'childish', 'mature', 'humorous', 'serious', 'mysterious', 'energetic']).optional(),
  catchphrase: z.string().optional(),
  age: z.number().optional(),
  gender: z.enum(['male', 'female', 'other']).optional()
})

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const { outline, style, existingCharacters } = RequestSchema.parse(body)

  // 合并角色来源：大纲建议的角色 + 场景中提取的角色名称
  const suggestedNames = outline.suggestedCharacters?.map(c => c.name) || []
  const allCharacterNames = [...new Set([...suggestedNames, ...(existingCharacters || [])])]

  // 构建角色信息上下文
  let characterContext = ''
  if (outline.suggestedCharacters && outline.suggestedCharacters.length > 0) {
    characterContext = `\n## 已知角色信息\n${JSON.stringify(outline.suggestedCharacters, null, 2)}`
  }
  if (existingCharacters && existingCharacters.length > 0) {
    const newNames = existingCharacters.filter(n => !suggestedNames.includes(n))
    if (newNames.length > 0) {
      characterContext += `\n\n## 场景中出现的其他角色\n${newNames.join(', ')}`
    }
  }

  const prompt = `你是一位专业的角色视觉设计师，擅长为动画/漫画角色设计详细的外貌特征。

## 故事信息

### 标题
${outline.title}

### 概要
${outline.synopsis}

### 故事结构
${outline.acts.map((act, i) => `第${i + 1}幕: ${act.summary}`).join('\n')}
${characterContext}

## 画风
${style}

## 需要设计的角色
${allCharacterNames.join(', ')}

## 外貌描述要求（appearance 字段）

必须包含以下所有类别的具体描述，总计 200-350 字：

### 1. 基础信息
- 性别、年龄段（如：青年女性，约20岁）
- 身材体型（如：身材纤细修长/娇小可爱/高挑健美）

### 2. 面部特征
- 脸型（鹅蛋脸/瓜子脸/圆脸/方脸等）
- 眼睛（颜色+形状+特点，如：琥珀色杏眼、双眼皮、长睫毛）
- 眉毛形状
- 肤色
- 其他特征（红晕、酒窝、痣等）

### 3. 发型发色
- 发色（具体颜色：黑色/栗色/金色/银白/粉色等）
- 发型（长度+样式：及腰长直发/齐肩波浪卷/双马尾/利落短发等）
- 刘海（齐刘海/斜刘海/空气刘海/无刘海等）
- 发饰（如有）

### 4. 服装搭配
- 上装（款式+颜色+细节）
- 下装（款式+颜色+长度）
- 鞋袜
- 外套（如有）

### 5. 配饰
- 首饰（项链、耳环、手链等）
- 眼镜（如有）
- 其他（包、帽子等）

### 6. 整体气质
- 气质关键词（温柔知性/活泼开朗/冷酷神秘等）
- 主色调

## 输出要求

1. **主角**（protagonist）：外貌描述最详细，300-350字，每个特征类别都要具体描述
2. **反派**（antagonist）：外貌描述详细，250-300字
3. **配角**（supporting）：外貌描述适中，200-250字

## 输出格式

请输出 JSON 数组，每个角色包含：
\`\`\`json
[
  {
    "name": "角色名",
    "role": "protagonist|antagonist|supporting",
    "appearance": "详细外貌描述（按上述要求，200-350字）",
    "personality": "性格描述（50-100字）",
    "traits": ["性格标签1", "性格标签2", "性格标签3"],
    "background": "角色背景（可选，30-50字）",
    "motivation": "角色动机（30-50字）",
    "speakingStyle": "formal|casual|polite|rude|childish|mature|humorous|serious|mysterious|energetic",
    "catchphrase": "口头禅（可选）",
    "age": 18,
    "gender": "male|female|other"
  }
]
\`\`\`

## 示例

\`\`\`json
[
  {
    "name": "林小雨",
    "role": "protagonist",
    "appearance": "${style}风格，青年女性，约19岁，身材纤细高挑，身高约165cm。精致的鹅蛋脸，皮肤白皙透亮，脸颊有淡淡的自然红晕。眼睛是清澈的深棕色，大而明亮的杏眼，双眼皮，睫毛浓密纤长，眼神中带着一丝倔强和坚定。柳叶眉，眉形自然柔和。小巧挺直的鼻子，淡粉色的饱满嘴唇。一头乌黑亮丽的长直发，发长及腰，发质顺滑如丝绸，斜刘海轻轻遮住右眼角，发尾微微内扣。穿着白色衬衫，领口系着深蓝色细丝带，外搭米色针织开衫。下身是深蓝色高腰A字裙，裙长及膝。脚穿白色短袜和棕色复古小皮鞋。左手腕戴着一块简约的银色手表，右手无名指戴着一枚小巧的银戒指。整体气质清新文艺、温婉坚韧，主色调为白、蓝、米色。",
    "personality": "外表温柔内敛，内心坚强独立。面对困难从不轻易放弃，有着超乎年龄的成熟和冷静。对朋友真诚热心，但不善于表达感情。",
    "traits": ["坚韧", "内敛", "善良", "独立"],
    "motivation": "寻找失踪的姐姐，揭开家族的秘密",
    "speakingStyle": "polite",
    "age": 19,
    "gender": "female"
  }
]
\`\`\`

## 重要提示
- 描述必须具体，禁止使用"普通""一般""正常"等模糊词汇
- 如果原文没有描述某个特征，请根据角色性格、故事背景和画风合理设计
- 确保所有角色的服装风格与故事背景和画风一致
- 禁止输出暴力、血腥、政治敏感内容

请直接输出 JSON 数组，不要包含其他内容。`

  try {
    // 从数据库获取提示词模板（已合并系统提示词和用户提示词）
    const finalPrompt = await getInterpolatedPrompt(
      PROMPT_TEMPLATE_IDS.CHARACTER_FROM_OUTLINE,
      {
        outline: JSON.stringify(outline),
        style
      }
    ) || prompt

    const selectedModels = getSelectedModels()
    const parsed = await generateJSON<z.infer<typeof CharacterSchema>[]>({
      modelId: selectedModels.text,
      prompt: finalPrompt,
      temperature: 0.7,
      maxRetries: 2
    })

    const characters = z.array(CharacterSchema).parse(parsed)

    return {
      success: true,
      characters: characters.map((char, idx) => ({
        id: `char_${Date.now()}_${idx}`,
        ...char
      }))
    }
  } catch (error: unknown) {
    console.error('角色提取失败:', error)

    // 降级：返回基础角色信息
    const fallbackCharacters = allCharacterNames.map((name, idx) => {
      const suggested = outline.suggestedCharacters?.find(c => c.name === name)
      return {
        id: `char_${Date.now()}_${idx}`,
        name,
        role: (suggested?.role as 'protagonist' | 'antagonist' | 'supporting') || 'supporting',
        appearance: suggested?.description || '',
        personality: suggested?.personality || '',
        traits: [] as string[],
        motivation: suggested?.motivation
      }
    })

    return {
      success: true,
      characters: fallbackCharacters,
      warning: '使用降级模式，角色信息可能不完整'
    }
  }
})
