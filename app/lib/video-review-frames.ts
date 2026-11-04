export interface VideoReviewMetadata {
  actualDuration: number
  dimensions: string
}

export interface VideoReviewIssue {
  severity: 'medium'
  reason: string
  suggestion: string
}

export function evaluateVideoReviewMetadata(media: VideoReviewMetadata, plannedDuration: number, aspectRatio: '16:9' | '9:16' | '1:1'): VideoReviewIssue[] {
  const issues: VideoReviewIssue[] = []
  if (Math.abs(media.actualDuration - plannedDuration) > Math.max(1, plannedDuration * 0.15)) {
    issues.push({ severity: 'medium', reason: `实际时长 ${media.actualDuration.toFixed(1)} 秒，与计划 ${plannedDuration} 秒不符`, suggestion: '检查模型时长设置或重新生成' })
  }
  const [width, height] = media.dimensions.split('x').map(Number)
  const expectedRatio = aspectRatio === '9:16' ? 9 / 16 : aspectRatio === '1:1' ? 1 : 16 / 9
  if (!width || !height || Math.abs(width / height - expectedRatio) > 0.1) {
    issues.push({ severity: 'medium', reason: `实际画幅 ${media.dimensions} 与项目画幅不符`, suggestion: '检查视频模型的比例参数并重生成' })
  }
  return issues
}
