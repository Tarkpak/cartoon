import { describe, expect, it } from 'vitest'
import type { OnlineSkillPreview } from '#shared/types/skill'
import { isSkillSource, onlineSkillBindingError } from './online-skills'

const preview = {
  blockingIssues: [], skill: { instructions: '逐镜细化。', files: { 'a.md': '参考' } }
} as unknown as OnlineSkillPreview

describe('online skill discovery and binding', () => {
  it('distinguishes keyword searches from supported source input', () => {
    expect(isSkillSource('storyboard')).toBe(false)
    expect(isSkillSource('cinematography lighting')).toBe(false)
    for (const input of ['https://skills.sh/a/b/c', 'owner/repo@skill', 'owner/repo']) expect(isSkillSource(input)).toBe(true)
  })
  it('requires explicit binding and preserves incompatibility errors', () => {
    expect(onlineSkillBindingError(preview, ['scene_detail'])).toBe('')
    expect(onlineSkillBindingError(preview, [])).toContain('请选择')
    expect(onlineSkillBindingError({ ...preview, blockingIssues: ['不支持 Bash'] }, ['scene_detail'])).toContain('Bash')
  })
  it('checks UTF-8 byte limits including reference files for the selected stage', () => {
    const large = { ...preview, skill: { ...preview.skill, files: { 'a.md': '字'.repeat(6000) } } }
    expect(onlineSkillBindingError(large, ['scene_detail'])).toBe('')
    expect(onlineSkillBindingError(large, ['video_review'])).toBe('')
    const withScript = { ...large, skill: { ...large.skill, files: { ...large.skill.files, 'scripts/check.py': 'x'.repeat(100000) } } }
    expect(onlineSkillBindingError(withScript, ['scene_detail'])).toBe('')
    expect(onlineSkillBindingError({ ...large, contextSizeBytes: 96 * 1024 + 1 }, ['scene_detail'])).toContain('96 KB')
    expect(onlineSkillBindingError({ ...large, skill: { ...large.skill, instructions: '中'.repeat(32769) } }, ['video_review'])).toContain('96 KB')
  })
})
