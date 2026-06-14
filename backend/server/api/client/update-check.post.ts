import { getDb, nowIso } from '../../utils/db'
import { readJsonBody, registerOrUpdateDevice, requireAuth } from '../../utils/auth'
import { optionalString } from '../../utils/http'
import { buildClientUpdateCheckResponse, normalizeClientTarget, normalizeVersionText } from '../../utils/client-versions'

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readJsonBody<{
    appKey?: string
    version?: string
    platform?: string
    arch?: string
    channel?: string
    deviceId?: string
    deviceName?: string
  }>(event)

  const deviceId = optionalString(body.deviceId, 128) || auth.deviceId || ''
  const currentVersion = normalizeVersionText(body.version)
  const platform = normalizeClientTarget(body.platform, 'all')

  if (deviceId) {
    registerOrUpdateDevice({
      userId: auth.user.id,
      deviceId,
      deviceName: optionalString(body.deviceName, 128) || 'Playlet Desktop',
      os: platform,
      clientVersion: currentVersion,
      allowDisabledGrace: true
    })
  }
  getDb().prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(nowIso(), auth.sessionId)

  return {
    success: true,
    data: buildClientUpdateCheckResponse({
      appKey: normalizeClientTarget(body.appKey, 'cartoon-desktop'),
      currentVersion,
      platform,
      arch: normalizeClientTarget(body.arch, 'all'),
      channel: normalizeClientTarget(body.channel, 'stable'),
      deviceId
    })
  }
})
