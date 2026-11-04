export interface ReviewRepairIssue {
  severity: string
  reason: string
  suggestion: string
}

export function actionableReviewIssues(issues: ReviewRepairIssue[]): ReviewRepairIssue[] {
  return issues.filter(issue => ['high', 'medium'].includes(issue.severity) && issue.reason.trim() && issue.suggestion.trim())
}

export function buildVideoReviewRepairInstruction(issues: ReviewRepairIssue[], duration: number): string {
  const actionable = actionableReviewIssues(issues)
  if (actionable.length === 0) return ''
  return [
    '根据上一次成片审查结果，仅修改当前分镜的可生成画面描述。保留原剧情事件、角色身份、对白原文、时长和参考资产；不要添加新剧情。',
    `镜头时长仍为约 ${duration} 秒。优先用具体可见的动作、构图和连续性约束解决问题，不要把审片意见原样附在末尾。`,
    ...actionable.map((issue, index) => `${index + 1}. 问题：${issue.reason}；修复方向：${issue.suggestion}`)
  ].join('\n')
}
