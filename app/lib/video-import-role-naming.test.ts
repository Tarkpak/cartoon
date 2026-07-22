import { describe, expect, it } from 'vitest'
import {
  applyVideoImportRoleRenames,
  parseVideoImportRoleCandidates
} from './video-import-role-naming'

describe('video import role naming', () => {
  it('parses stable role ids and preserves confirmed names', () => {
    const input = `# 示例
## 角色
- 角色1｜当前称呼：主人公｜姓名：未明确｜身份：工地工人｜别名：小六、小洛
- 角色2｜当前称呼：唐小满｜姓名：唐小满｜身份：摊主｜别名：无
## 剧情梗概
主人公来到新摊。`

    expect(parseVideoImportRoleCandidates(input)).toEqual([
      {
        id: '角色1',
        currentLabel: '主人公',
        name: '',
        aliases: ['小六', '小洛'],
        source: 'stable'
      },
      {
        id: '角色2',
        currentLabel: '唐小满',
        name: '唐小满',
        aliases: [],
        source: 'stable'
      }
    ])
  })

  it('updates the stable manifest and every canonical role reference', () => {
    const input = `## 角色
- 角色1｜当前称呼：主人公｜姓名：未明确｜身份：工人
## 分场剧本
主人公走到摊前。
主人公：多少钱？`

    const output = applyVideoImportRoleRenames(input, [{
      id: '角色1',
      currentLabel: '主人公',
      name: '洛川',
      source: 'stable'
    }])

    expect(output).toContain('- 角色1｜当前称呼：洛川｜姓名：洛川｜身份：工人')
    expect(output).toContain('洛川走到摊前。')
    expect(output).toContain('洛川：多少钱？')
  })

  it('keeps role A and B scripts compatible', () => {
    const input = `## 分场剧本
角色A走到摊前。
A：多少钱？
角色B：38元。`
    const candidates = parseVideoImportRoleCandidates(input)

    expect(candidates.map(candidate => candidate.currentLabel)).toEqual(['角色A', '角色B'])
    expect(applyVideoImportRoleRenames(input, [{
      ...candidates[0],
      name: '洛川'
    }])).toContain('洛川走到摊前。\n洛川：多少钱？')
  })

  it('does not cascade names across a batch rename', () => {
    const input = `## 角色
- 角色1｜当前称呼：主人公｜姓名：未明确｜身份：工人
- 角色2｜当前称呼：老板娘｜姓名：未明确｜身份：摊主
## 分场剧本
主人公：不吃了。
老板娘：炒都炒了。`

    const output = applyVideoImportRoleRenames(input, [
      { id: '角色1', currentLabel: '主人公', name: '老板娘', source: 'stable' },
      { id: '角色2', currentLabel: '老板娘', name: '罗姐', source: 'stable' }
    ])

    expect(output).toContain('老板娘：不吃了。')
    expect(output).toContain('罗姐：炒都炒了。')
  })

  it('continues to parse the earlier role underscore id format', () => {
    const input = `## 角色
- role_1｜当前称呼：主人公｜姓名：未明确｜身份：工人｜别名：无
## 分场剧本
主人公：多少钱？`

    expect(parseVideoImportRoleCandidates(input)[0]?.id).toBe('role_1')
  })

  it('extracts semantic labels from older role sections', () => {
    const input = `## 角色
1. **主人公**
   - 工地工人。
2. **原炒鸡摊老板娘**
   - 经营旧摊。
## 剧情梗概
主人公发现价格不同。`

    expect(parseVideoImportRoleCandidates(input).map(candidate => candidate.currentLabel)).toEqual([
      '主人公',
      '原炒鸡摊老板娘'
    ])
  })
})
