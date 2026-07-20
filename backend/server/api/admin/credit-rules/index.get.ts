import { getDb } from '../../../utils/db'
import { requireAdmin } from '../../../utils/auth'

export default defineEventHandler((event) => {
  requireAdmin(event)
  const rules = getDb().prepare(`
    SELECT id, operation, provider, model_id, credits, enabled, created_at, updated_at
    FROM credit_rules
    ORDER BY CASE operation
      WHEN 'generateText' THEN 1
      WHEN 'generateImage' THEN 2
      WHEN 'generateVideo' THEN 3
      WHEN 'textToSpeech' THEN 4
      ELSE 5
    END, provider, model_id
  `).all()
  return { success: true, data: { rules } }
})
