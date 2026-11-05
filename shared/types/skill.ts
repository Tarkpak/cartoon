export type SkillStage = 'script_polish' | 'scene_detail' | 'video_review'
export interface WorkflowSkill {
  id: string
  name: string
  description: string
  version: string
  stages: string[]
  instructions: string
  files: Record<string, string>
  unsupported: string[]
  warnings?: string[]
  enabled: boolean
  builtin: boolean
  origin?: SkillOrigin
  originalDocument?: string
}
export interface SkillRun {
  id: string
  projectId: string
  stage: SkillStage
  createdAt: string
  durationMs?: number
  syncStatus?: 'pending' | 'synced' | 'legacy'
  finishedAt?: string
  status: 'running' | 'succeeded' | 'failed' | 'skipped' | 'interrupted'
  skills: Array<Pick<WorkflowSkill, 'id' | 'name' | 'version' | 'origin'>>
  result?: { message?: string, sceneCount?: number, passed?: boolean, issueCount?: number }
}
export const SKILL_STAGE_LABELS: Record<SkillStage, string> = {
  script_polish: '剧本／对白润色',
  scene_detail: '解析后的分镜细化',
  video_review: '视频抽帧审片'
}

export interface SkillOrigin {
  provider: 'github'
  repository: string
  path: string
  commit: string
  url: string
  contentHash: string
  installedAt?: string
}
export interface OnlineSkillResult {
  name: string
  source: string
  repository: string
  skillId: string
  installs: number
  url: string
}
export interface OnlineSkillPreview {
  kind: 'preview'
  token: string
  skill: WorkflowSkill
  origin: SkillOrigin
  packageSizeBytes?: number
  contextSizeBytes?: number
  fileCount?: number
  blockingIssues: string[]
  warnings?: string[]
  expiresInSeconds: number
}
export interface OnlineSkillDirectories {
  kind: 'choose'
  repository: string
  commit: string
  paths: string[]
}

export interface SkillCallContext {
  runId: string
  stage: SkillStage
  skills: Array<Pick<WorkflowSkill, 'id' | 'name' | 'version' | 'origin'>>
  batchStart?: number
  batchEnd?: number
  attempt?: number
}
