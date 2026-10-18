import { getDb } from '../../utils/db'
import { readJsonBody, requireAuth } from '../../utils/auth'
import { handleProjectCollaboration } from '../../utils/project-collaboration-api'

export default defineEventHandler(async event => {
  const auth = requireAuth(event)
  const body = await readJsonBody<Record<string, unknown>>(event)
  return { success: true, data: handleProjectCollaboration(getDb(), auth, body) }
})
