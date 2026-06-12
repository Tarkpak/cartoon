import { randomUUID } from 'node:crypto'
import { getDb, jsonText, nowIso } from '../../../utils/db'
import { readJsonBody, requireAuth } from '../../../utils/auth'
import { optionalString } from '../../../utils/http'

interface PromptProfilePayload {
  id?: string
  localProfileId?: string
  name?: string
  description?: string
  isActive?: boolean
}

interface PromptTemplatePayload {
  id?: string
  localTemplateId?: string
  profileId?: string
  localProfileId?: string
  key?: string
  templateKey?: string
  title?: string
  content?: string
  source?: string
}

export default defineEventHandler(async (event) => {
  const auth = requireAuth(event)
  const body = await readJsonBody<{
    snapshot?: unknown
    profiles?: PromptProfilePayload[]
    templates?: PromptTemplatePayload[]
  }>(event)
  const db = getDb()
  const timestamp = nowIso()
  const snapshot = body.snapshot ?? body

  db.transaction(() => {
    db.prepare(`
      INSERT INTO user_prompt_state (user_id, snapshot_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        snapshot_json = excluded.snapshot_json,
        updated_at = excluded.updated_at
    `).run(auth.user.id, jsonText(snapshot), timestamp)

    db.prepare(`
      INSERT INTO user_prompt_snapshots (id, user_id, snapshot_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(randomUUID(), auth.user.id, jsonText(snapshot), timestamp)

    const upsertProfile = db.prepare(`
      INSERT INTO user_prompt_profiles
        (id, user_id, local_profile_id, name, description, is_active, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, local_profile_id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        is_active = excluded.is_active,
        updated_at = excluded.updated_at
    `)
    const selectProfile = db.prepare('SELECT id FROM user_prompt_profiles WHERE user_id = ? AND local_profile_id = ? LIMIT 1')
    const upsertTemplate = db.prepare(`
      INSERT INTO user_prompt_templates
        (id, user_id, profile_id, local_template_id, template_key, title, content, source, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, profile_id, template_key) DO UPDATE SET
        local_template_id = excluded.local_template_id,
        title = excluded.title,
        content = excluded.content,
        source = excluded.source,
        updated_at = excluded.updated_at
    `)

    for (const profile of body.profiles || []) {
      const localProfileId = optionalString(profile.localProfileId || profile.id, 128) || 'default'
      const existing = selectProfile.get(auth.user.id, localProfileId) as { id: string } | undefined
      upsertProfile.run(
        existing?.id || randomUUID(),
        auth.user.id,
        localProfileId,
        optionalString(profile.name, 256) || localProfileId,
        optionalString(profile.description, 2048),
        profile.isActive ? 1 : 0,
        timestamp,
        timestamp
      )
    }

    for (const template of body.templates || []) {
      const localProfileId = optionalString(template.localProfileId || template.profileId, 128) || 'default'
      let profile = selectProfile.get(auth.user.id, localProfileId) as { id: string } | undefined
      if (!profile) {
        const profileId = randomUUID()
        upsertProfile.run(profileId, auth.user.id, localProfileId, localProfileId, '', 0, timestamp, timestamp)
        profile = { id: profileId }
      }
      const templateKey = optionalString(template.templateKey || template.key || template.id, 256)
      if (!templateKey) continue
      upsertTemplate.run(
        randomUUID(),
        auth.user.id,
        profile.id,
        optionalString(template.localTemplateId || template.id, 128),
        templateKey,
        optionalString(template.title, 256) || templateKey,
        typeof template.content === 'string' ? template.content : '',
        optionalString(template.source, 64) || 'user_custom',
        timestamp,
        timestamp
      )
    }
  })()

  return { success: true }
})

