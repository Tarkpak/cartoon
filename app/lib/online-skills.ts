import type { OnlineSkillPreview, SkillStage } from '#shared/types/skill'

export function isSkillSource(value: string): boolean {
  return /^https?:\/\//i.test(value.trim()) || /^[\w.-]+\/[\w.-]+(?:@[\w.-]+)?$/.test(value.trim())
}

export function onlineSkillBindingError(preview: OnlineSkillPreview, stages: SkillStage[]): string {
  if (preview.blockingIssues.length) return preview.blockingIssues.join('；')
  if (!stages.length) return '请选择至少一个适用流程'
  const encoder = new TextEncoder()
  const bytes = preview.contextSizeBytes ?? (encoder.encode(preview.skill.instructions).length
    + Object.entries(preview.skill.files)
      .filter(([path]) => !path.split('/').some(part => ['scripts', 'agents', 'dist'].includes(part)) && /\.(md|txt|json)$/.test(path))
      .reduce((total, [, text]) => total + encoder.encode(text).length, 0))
  if (bytes > 96 * 1024) return '此技能正文与参考资料超过 96 KB 上下文上限'
  return ''
}
