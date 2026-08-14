import { getDb, nowIso } from '../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { optionalString } from '../../../utils/http'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const body = await readJsonBody<{
    templateKey?: string
    title?: string
    content?: string
  }>(event)

  const templateKey = optionalString(body.templateKey, 128)
  if (!templateKey) {
    throw createError({ statusCode: 400, statusMessage: 'templateKey is required' })
  }

  const db = getDb()
  const content = typeof body.content === 'string' ? body.content : ''
  const cleared = !content.trim()

  if (cleared) {
    db.prepare('DELETE FROM system_prompt_templates WHERE template_key = ?').run(templateKey)
  } else {
    db.prepare(`
      INSERT INTO system_prompt_templates (template_key, title, content, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(template_key) DO UPDATE SET
        title = excluded.title,
        content = excluded.content,
        updated_at = excluded.updated_at
    `).run(templateKey, optionalString(body.title, 256), content, nowIso())
  }

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: cleared ? 'admin.prompt-templates.reset' : 'admin.prompt-templates.update',
    targetType: 'system_prompt_templates',
    targetId: templateKey,
    metadata: { templateKey, contentLength: content.length }
  })

  return {
    success: true,
    data: { templateKey, cleared }
  }
})
