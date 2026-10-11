import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'
import { loadBuiltinPromptTemplates } from '../../../utils/default-prompt-templates'

export default defineEventHandler(async (event) => {
  requireAdmin(event)
  const db = getDb()
  const templates = db
    .prepare(`
      SELECT template_key, title, content, updated_at
      FROM system_prompt_templates
      ORDER BY template_key ASC
    `)
    .all()

  const builtinTemplates = await loadBuiltinPromptTemplates(fileName =>
    useStorage('assets:default-prompts').getItem(fileName)
  )

  return {
    success: true,
    data: { templates, builtinTemplates }
  }
})
