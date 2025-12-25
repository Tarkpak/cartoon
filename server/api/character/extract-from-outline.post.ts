import { z } from 'zod'
import { generateJSON, getSelectedModels } from '../../utils/model-provider'

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
  style: z.string().optional().default('日式动漫'),
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

  const prompt = `你是一位专业的角色设计师。请根据以下故事大纲和角色信息，为每个角色生成详细的设定。

## 故事标题
${outline.title}

## 故事概要
${outline.synopsis}

## 故事结构
${outline.acts.map((act, i) => `第${i + 1}幕: ${act.summary}`).join('\n')}
${characterContext}

## 画风
${style}

## 需要生成设定的角色
${allCharacterNames.join(', ')}

## 要求
1. 为每个角色生成详细的外貌描述（适合 ${style} 风格，包含发型、发色、眼睛颜色、服装等，100-200字）
2. 完善性格描述和性格标签（3-5个标签）
3. 推断合适的说话风格和可能的口头禅
4. 根据故事内容推断年龄和性别
5. 确保角色设定与故事背景和风格一致
6. 主角的外貌描述要更详细，配角可以简略一些

## 输出格式
请输出 JSON 数组：
[
  {
    "name": "角色名",
    "role": "protagonist|antagonist|supporting",
    "appearance": "详细外貌描述（发型、发色、眼睛、服装等，100-200字）",
    "personality": "性格描述（50-100字）",
    "traits": ["性格标签1", "性格标签2", "性格标签3"],
    "background": "角色背景（可选）",
    "motivation": "角色动机",
    "speakingStyle": "formal|casual|polite|rude|childish|mature|humorous|serious|mysterious|energetic",
    "catchphrase": "口头禅（可选）",
    "age": 18,
    "gender": "male|female|other"
  }
]

请直接输出 JSON 数组，不要包含其他内容。`

  try {
    const selectedModels = getSelectedModels()
    const parsed = await generateJSON<z.infer<typeof CharacterSchema>[]>({
      modelId: selectedModels.text,
      prompt,
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
