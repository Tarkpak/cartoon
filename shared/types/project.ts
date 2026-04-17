export const PROJECT_WORKFLOW_TYPES = ['asset_consistency'] as const

export type ProjectWorkflowType = (typeof PROJECT_WORKFLOW_TYPES)[number]

export const PROJECT_WORKFLOW_LABELS: Record<ProjectWorkflowType, string> = {
  asset_consistency: '素材一致性'
}

export const PROJECT_WORKFLOW_DESCRIPTIONS: Record<ProjectWorkflowType, string> = {
  asset_consistency: '先产出角色/场景素材并绑定引用，再批量生成场景视频，适合强一致性项目'
}

export function normalizeProjectWorkflowType(_value: unknown): ProjectWorkflowType {
  return 'asset_consistency'
}

export function resolveProjectWorkbenchPath(
  projectId: string,
  _workflowType?: ProjectWorkflowType | string | null | undefined
): string {
  return `/asset-workbench?project=${projectId}`
}
