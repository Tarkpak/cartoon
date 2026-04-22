/**
 * 获取所有提示词模板
 * GET /api/prompts
 */

import { getAllPromptTemplates, getPromptProfiles } from '../../utils/prompt-template'
import { resolvePromptWorkflowFromEvent } from '../../utils/prompt-workflow'
import {
  CATEGORY_NAMES,
  getPromptTemplateMetadataForWorkflow
} from '../../../shared/types/prompt-template'

export default defineEventHandler(async (event) => {
  try {
    const workflow = resolvePromptWorkflowFromEvent(event)
    const templates = await getAllPromptTemplates(workflow)
    const profileData = await getPromptProfiles(workflow)
    const metadataList = getPromptTemplateMetadataForWorkflow(workflow)
    const metadata = {
      text: metadataList.filter(t => t.category === 'text'),
      image: metadataList.filter(t => t.category === 'image'),
      video: metadataList.filter(t => t.category === 'video')
    }

    // 按分类分组
    const grouped = {
      text: templates.filter(t => t.category === 'text'),
      image: templates.filter(t => t.category === 'image'),
      video: templates.filter(t => t.category === 'video')
    }

    return {
      success: true,
      data: {
        workflow,
        templates,
        grouped,
        categoryNames: CATEGORY_NAMES,
        metadata,
        profiles: profileData.profiles,
        activeProfileId: profileData.activeProfileId
      }
    }
  } catch (error) {
    console.error('[Prompts API] 获取模板失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: '获取提示词模板失败',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
