export const PROJECT_WORKFLOW_TYPES = ['classic', 'asset_consistency'] as const

export type ProjectWorkflowType = (typeof PROJECT_WORKFLOW_TYPES)[number]

export const PROJECT_WORKFLOW_LABELS: Record<ProjectWorkflowType, string> = {
  classic: '标准工作流',
  asset_consistency: '资产一致性工作流'
}

export const PROJECT_WORKFLOW_DESCRIPTIONS: Record<ProjectWorkflowType, string> = {
  classic: '线性流程：剧本 -> 角色 -> 场景 -> 视频，适合快速出片',
  asset_consistency: '先产出角色/场景资产并绑定引用，再批量生成场景视频，适合强一致性项目'
}

export function normalizeProjectWorkflowType(value: unknown): ProjectWorkflowType {
  return value === 'asset_consistency' ? 'asset_consistency' : 'classic'
}

export function resolveProjectWorkbenchPath(
  projectId: string,
  workflowType: ProjectWorkflowType | string | null | undefined
): string {
  const normalized = normalizeProjectWorkflowType(workflowType)
  if (normalized === 'asset_consistency') {
    return `/asset-workbench?project=${projectId}`
  }
  return `/workbench?project=${projectId}`
}
