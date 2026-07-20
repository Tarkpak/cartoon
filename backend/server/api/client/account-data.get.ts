import { getDb, parseJsonText } from '../../utils/db'
import { requireAuth } from '../../utils/auth'
import { projectOwnerScope } from '../../utils/admin-resource-scope'

export default defineEventHandler((event) => {
  const auth = requireAuth(event)
  const db = getDb()

  const projectScope = projectOwnerScope(auth.user.role, auth.user.id)
  const projects = db
    .prepare(`
      SELECT
        p.id,
        p.user_id,
        u.account AS owner_account,
        u.display_name AS owner_display_name,
        p.local_project_id,
        p.name,
        p.description,
        p.script_parse_mode,
        p.style_id,
        p.aspect_ratio,
        p.status,
        p.summary_json,
        p.local_created_at,
        p.local_updated_at,
        p.last_synced_at,
        p.created_at,
        p.updated_at,
        s.snapshot_json,
        s.created_at AS snapshot_created_at
      FROM user_projects p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN user_project_snapshots s
        ON s.id = (
          SELECT latest.id
          FROM user_project_snapshots latest
          WHERE latest.project_id = p.id
          ORDER BY latest.created_at DESC
          LIMIT 1
        )
      ${projectScope.where}
      ORDER BY p.updated_at DESC
    `)
    .all(...projectScope.params) as Array<{
      id: string
      user_id: string
      owner_account: string
      owner_display_name: string
      local_project_id: string
      name: string
      description: string | null
      script_parse_mode: string | null
      style_id: string | null
      aspect_ratio: string | null
      status: string | null
      summary_json: string | null
      local_created_at: string | null
      local_updated_at: string | null
      last_synced_at: string
      created_at: string
      updated_at: string
      snapshot_json: string | null
      snapshot_created_at: string | null
    }>

  const promptState = db
    .prepare('SELECT snapshot_json, updated_at FROM user_prompt_state WHERE user_id = ? LIMIT 1')
    .get(auth.user.id) as { snapshot_json: string, updated_at: string } | undefined

  const modelPreferences = db
    .prepare(`
      SELECT workflow_step, model_id, model_options_json, updated_at
      FROM user_model_preferences
      WHERE user_id = ?
      ORDER BY workflow_step ASC
    `)
    .all(auth.user.id) as Array<{
      workflow_step: string
      model_id: string
      model_options_json: string | null
      updated_at: string
    }>

  const modelCallLogs = auth.user.role === 'admin'
    ? db.prepare(`
        SELECT l.*, u.account AS owner_account, u.display_name AS owner_display_name
        FROM model_call_logs l
        JOIN users u ON u.id = l.user_id
        WHERE l.archived_at IS NULL
        ORDER BY l.created_at DESC
        LIMIT 1000
      `).all() as Array<Record<string, unknown>>
    : []

  return {
    success: true,
    data: {
      projects: projects.map(project => ({
        id: project.id,
        ownerUserId: project.user_id,
        ownerAccount: project.owner_account,
        ownerDisplayName: project.owner_display_name,
        localProjectId: project.local_project_id,
        name: project.name,
        description: project.description || '',
        scriptParseMode: project.script_parse_mode || '',
        styleId: project.style_id || '',
        aspectRatio: project.aspect_ratio || '',
        status: project.status || '',
        summary: parseJsonText(project.summary_json, {}),
        localCreatedAt: project.local_created_at,
        localUpdatedAt: project.local_updated_at,
        lastSyncedAt: project.last_synced_at,
        updatedAt: project.updated_at,
        snapshotCreatedAt: project.snapshot_created_at,
        snapshot: parseJsonText(project.snapshot_json, null)
      })),
      promptState: promptState
        ? {
            updatedAt: promptState.updated_at,
            snapshot: parseJsonText(promptState.snapshot_json, null)
          }
        : null,
      modelPreferences: modelPreferences.map(preference => ({
        workflowStep: preference.workflow_step,
        modelId: preference.model_id,
        modelOptions: parseJsonText(preference.model_options_json, {}),
        updatedAt: preference.updated_at
      })),
      modelCallLogs
    }
  }
})
