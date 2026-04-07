/**
 * 角色管理 Composable
 * 提供角色生成和管理功能
 */

import type { Emotion } from '../../shared/types/script'
import type { CharacterState } from '../../shared/types/character'

export interface GenerateCharacterOptions {
  style: string  // 必填，由项目配置决定
  emotions?: Emotion[]
}

const DEFAULT_EMOTIONS: Emotion[] = ['neutral', 'happy', 'sad', 'angry', 'surprised']

export function useCharacter() {
  const characters = ref<CharacterState[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)
  const generatingIds = ref<Set<string>>(new Set())

  /**
   * 生成角色资产
   */
  async function generateCharacter(
    character: { name: string, description: string, role?: CharacterState['role'] },
    options?: GenerateCharacterOptions
  ) {
    const characterId = `char_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    const emotions = options?.emotions || DEFAULT_EMOTIONS

    // 添加角色到列表（生成中状态）
    const newCharacter: CharacterState = {
      id: characterId,
      name: character.name,
      description: character.description,
      role: character.role,
      generating: true,
      expressions: []
    }
    characters.value.push(newCharacter)
    generatingIds.value.add(characterId)

    try {
      const data = await $fetch<{
        success: boolean
        characterId: string
        baseImage: { imageData: string, mimeType: string }
        expressions: Array<{
          emotion: string
          imageData: string
          mimeType: string
        }>
      }>('/api/character/generate', {
        method: 'POST',
        body: {
          character: {
            id: characterId,
            name: character.name,
            description: character.description
          },
          emotions,
          style: options?.style || ''
        }
      })

      // 更新角色信息
      const index = characters.value.findIndex(c => c.id === characterId)
      if (index !== -1) {
        const existingChar = characters.value[index]
        if (existingChar) {
          characters.value[index] = {
            ...existingChar,
            avatar: `data:${data.baseImage.mimeType};base64,${data.baseImage.imageData}`,
            expressions: data.expressions.map(e => ({
              emotion: e.emotion as Emotion,
              imageData: e.imageData,
              mimeType: e.mimeType
            })),
            generating: false
          }
        }
      }

      return characters.value[index] ?? null
    } catch (e) {
      error.value = e instanceof Error ? e.message : '角色生成失败'
      console.error('[useCharacter] generateCharacter error:', e)

      // 移除失败的角色或标记为失败
      const index = characters.value.findIndex(c => c.id === characterId)
      const failedChar = characters.value[index]
      if (index !== -1 && failedChar) {
        failedChar.generating = false
      }
      return null
    } finally {
      generatingIds.value.delete(characterId)
    }
  }

  /**
   * 重新生成角色表情
   */
  async function regenerateExpression(characterId: string, emotion: Emotion) {
    const character = characters.value.find(c => c.id === characterId)
    if (!character) {
      error.value = '角色不存在'
      return null
    }

    loading.value = true
    error.value = null

    try {
      const data = await $fetch<{
        success: boolean
        expression: {
          emotion: string
          imageData: string
          mimeType: string
        }
      }>('/api/character/generate', {
        method: 'POST',
        body: {
          character: {
            id: characterId,
            name: character.name,
            description: character.description
          },
          emotions: [emotion],
          baseImage: character.avatar
        }
      })

      // 更新表情
      const charIndex = characters.value.findIndex(c => c.id === characterId)
      const targetChar = characters.value[charIndex]
      if (charIndex !== -1 && data.expression && targetChar) {
        const expressions = targetChar.expressions || []
        const exprIndex = expressions.findIndex(e => e.emotion === emotion)

        const newExpr = {
          emotion: data.expression.emotion as Emotion,
          imageData: data.expression.imageData,
          mimeType: data.expression.mimeType
        }

        if (exprIndex !== -1) {
          expressions[exprIndex] = newExpr
        } else {
          expressions.push(newExpr)
        }

        targetChar.expressions = expressions
      }

      return data.expression
    } catch (e) {
      error.value = e instanceof Error ? e.message : '表情重新生成失败'
      console.error('[useCharacter] regenerateExpression error:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  /**
   * 更新角色信息
   */
  function updateCharacter(id: string, updates: Partial<CharacterState>) {
    const index = characters.value.findIndex(c => c.id === id)
    const existingChar = characters.value[index]
    if (index !== -1 && existingChar) {
      characters.value[index] = { ...existingChar, ...updates }
      return characters.value[index] ?? null
    }
    return null
  }

  /**
   * 删除角色
   */
  function deleteCharacter(id: string) {
    const index = characters.value.findIndex(c => c.id === id)
    if (index !== -1) {
      characters.value.splice(index, 1)
      return true
    }
    return false
  }

  /**
   * 获取角色的特定表情
   */
  function getExpression(characterId: string, emotion: Emotion) {
    const character = characters.value.find(c => c.id === characterId)
    return character?.expressions?.find(e => e.emotion === emotion)
  }

  /**
   * 检查角色是否正在生成
   */
  function isGenerating(characterId: string) {
    return generatingIds.value.has(characterId)
  }

  /**
   * 清空所有角色
   */
  function reset() {
    characters.value = []
    generatingIds.value.clear()
    error.value = null
  }

  return {
    // 状态
    characters,
    loading,
    error,
    generatingIds,
    // 方法
    generateCharacter,
    regenerateExpression,
    updateCharacter,
    deleteCharacter,
    getExpression,
    isGenerating,
    reset
  }
}
