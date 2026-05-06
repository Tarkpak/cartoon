export const PROJECT_WORKFLOW_TYPES = ['asset_consistency'] as const

export type ProjectWorkflowType = (typeof PROJECT_WORKFLOW_TYPES)[number]
export type ProjectWorkbenchStage = 'parse' | 'assets' | 'videos' | 'final'

export const PROJECT_WORKFLOW_LABELS: Record<ProjectWorkflowType, string> = {
  asset_consistency: '资产一致性'
}

export const PROJECT_WORKFLOW_DESCRIPTIONS: Record<ProjectWorkflowType, string> = {
  asset_consistency: '先产出角色/环境资产并绑定引用，再批量生成分镜视频，适合强一致性项目'
}

export function normalizeProjectWorkflowType(_value: unknown): ProjectWorkflowType {
  return 'asset_consistency'
}

export function resolveProjectWorkbenchPath(
  projectId: string,
  _workflowType?: ProjectWorkflowType | string | null | undefined,
  stage?: ProjectWorkbenchStage
): string {
  const query = new URLSearchParams({
    project: projectId
  })
  if (stage) {
    query.set('stage', stage)
  }
  return `/asset-workbench?${query.toString()}`
}

export function resolveProjectDetailPath(projectId: string): string {
  return resolveProjectWorkbenchPath(projectId)
}
