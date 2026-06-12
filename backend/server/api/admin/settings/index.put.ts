import { getAppSettings, setSetting } from '../../../utils/db'
import { readJsonBody, requireAdmin } from '../../../utils/auth'
import { writeAudit } from '../../../utils/audit'

export default defineEventHandler(async (event) => {
  const auth = requireAdmin(event)
  const body = await readJsonBody<{
    maxDevicesPerUser?: number
    restrictConcurrentDevices?: boolean
    maxConcurrentDevices?: number
    disabledGraceSeconds?: number
    logArchiveMaxRows?: number
  }>(event)

  if (typeof body.maxDevicesPerUser === 'number') {
    setSetting('max_devices_per_user', String(Math.max(1, Math.floor(body.maxDevicesPerUser))))
  }
  if (typeof body.restrictConcurrentDevices === 'boolean') {
    setSetting('restrict_concurrent_devices', body.restrictConcurrentDevices ? 'true' : 'false')
  }
  if (typeof body.maxConcurrentDevices === 'number') {
    setSetting('max_concurrent_devices', String(Math.max(1, Math.floor(body.maxConcurrentDevices))))
  }
  if (typeof body.disabledGraceSeconds === 'number') {
    setSetting('disabled_grace_seconds', String(Math.max(0, Math.floor(body.disabledGraceSeconds))))
  }
  if (typeof body.logArchiveMaxRows === 'number') {
    setSetting('log_archive_max_rows', String(Math.max(1000, Math.floor(body.logArchiveMaxRows))))
  }

  writeAudit(event, {
    actorUserId: auth.user.id,
    action: 'admin.settings.update',
    targetType: 'app_settings',
    metadata: body
  })

  return {
    success: true,
    data: getAppSettings()
  }
})

