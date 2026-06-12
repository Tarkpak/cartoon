import { getDb, nowIso } from '../../../utils/db'
import { readJsonBody, registerOrUpdateDevice, requireAuth } from '../../../utils/auth'
import { optionalString } from '../../../utils/http'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readJsonBody<{
    deviceId?: string
    deviceName?: string
    os?: string
    clientVersion?: string
  }>(event)
  const deviceId = optionalString(body.deviceId, 128) || auth.deviceId || ''
  if (deviceId) {
    registerOrUpdateDevice({
      userId: auth.user.id,
      deviceId,
      deviceName: optionalString(body.deviceName, 128),
      os: optionalString(body.os, 64),
      clientVersion: optionalString(body.clientVersion, 64),
      allowDisabledGrace: true
    })
  }
  getDb().prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), auth.sessionId)
  return { success: true }
})
