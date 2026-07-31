import { getDb, parseJsonText } from '../../utils/db'
import { requireAuth } from '../../utils/auth'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const db = getDb()
  const promptState = db.prepare(
    'SELECT snapshot_json, updated_at FROM user_prompt_state WHERE user_id = ? LIMIT 1'
  ).get(auth.user.id) as { snapshot_json: string, updated_at: string } | undefined

  return {
    success: true,
    data: {
      promptState: promptState
        ? { updatedAt: promptState.updated_at, snapshot: parseJsonText(promptState.snapshot_json, null) }
        : null
    }
  }
})
