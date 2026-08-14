import { requireAuth } from '../../../../utils/auth'
import { requiredParam } from '../../../../utils/http'
import { resolveVoicePreview } from '../../../../utils/voice-preset-previews'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const speakerId = requiredParam(event, 'speakerId')
  const preview = await resolveVoicePreview(speakerId, auth.user.id)
  return { success: true, data: preview }
})
