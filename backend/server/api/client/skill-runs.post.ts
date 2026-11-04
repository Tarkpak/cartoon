import { readJsonBody, requireAuth } from '../../utils/auth'
import { getDb } from '../../utils/db'
import { saveSkillRun } from '../../utils/skill-logs'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readJsonBody(event)
  const id = saveSkillRun(getDb(), auth.user.id, body)
  return { success: true, data: { id } }
})
