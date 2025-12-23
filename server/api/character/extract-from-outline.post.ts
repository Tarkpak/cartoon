import { z } from 'zod'
import { getGeminiClient } from '../../utils/gemini'

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
  style: z.string().optional().default('日式动漫')
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
  const { outline, style } = RequestSchema.parse(body)

  // 如果大纲已经有建议的角色，直接增强它们
  if (outline.suggestedCharacters && outline.suggestedCharacters.length > 0) {
    const client = getGeminiClient()

    const prompt = `你是一位专业的角色设计师。请根据以下故事大纲和初步角色信息，为每个角色生成详细的设定。

## 故事概要
${outline.synopsis}

## 初步角色列表
${JSON.stringify(outline.suggestedCharacters, null, 2)}

## 画风
${style}

## 要求
1. 为每个角色生成详细的外貌描述（适合 ${style} 风格）
2. 完善性格描述和性格标签
3. 推断合适的说话风格和可能的口头禅
4. 如果能推断，给出年龄和性别

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
      const response = await client.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.7
        }
      })

      const text = response.text || ''
      const jsonMatch = text.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        throw new Error('无法解析 AI 响应')
      }

      const parsed = JSON.parse(jsonMatch[0])
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
      // 降级：返回原始建议角色
      return {
        success: true,
        characters: outline.suggestedCharacters.map((char, idx) => ({
          id: `char_${Date.now()}_${idx}`,
          name: char.name,
          role: char.role as 'protagonist' | 'antagonist' | 'supporting',
          appearance: char.description,
          personality: char.personality || '',
          traits: [],
          motivation: char.motivation
        }))
      }
    }
  }

  // 如果没有建议角色，从大纲内容提取
  const client = getGeminiClient()
  const allContent = [
    outline.synopsis,
    ...outline.acts.map(a => a.summary),
    ...outline.acts.flatMap(a => a.keyEvents)
  ].join('\n')

  const prompt = `你是一位专业的角色设计师。请从以下故事内容中提取所有角色，并为每个角色生成详细设定。

## 故事内容
${allContent}

## 画风
${style}

## 要求
1. 识别所有出现的角色（主角、反派、配角）
2. 为每个角色生成详细的外貌描述（适合 ${style} 风格）
3. 推断性格特点和说话风格
4. 如果能推断，给出年龄和性别

## 输出格式
请输出 JSON 数组：
[
  {
    "name": "角色名",
    "role": "protagonist|antagonist|supporting",
    "appearance": "详细外貌描述",
    "personality": "性格描述",
    "traits": ["性格标签1", "性格标签2"],
    "motivation": "角色动机",
    "speakingStyle": "formal|casual|polite|rude|childish|mature|humorous|serious|mysterious|energetic",
    "age": 18,
    "gender": "male|female|other"
  }
]

请直接输出 JSON 数组。`

  try {
    const response = await client.models.generateContent({
      model: 'gemini-3-flash-preview',
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        temperature: 0.7
      }
    })

    const text = response.text || ''
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) {
      throw new Error('无法解析 AI 响应')
    }

    const parsed = JSON.parse(jsonMatch[0])
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
    return {
      success: false,
      error: error instanceof Error ? error.message : '角色提取失败',
      characters: []
    }
  }
})
