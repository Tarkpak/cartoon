import { describe, expect, it } from 'vitest'
import { readSkillDirectory, readSkillZip } from './skill-package'

function file(path: string, contents: string, size?: number): File {
  const bytes = new TextEncoder().encode(contents)
  return {
    name: path.split('/').at(-1), webkitRelativePath: path,
    size: size ?? bytes.byteLength, arrayBuffer: async () => bytes.buffer
  } as File
}

describe('skill package upload', () => {
  it('preserves directory paths and UTF-8 references', async () => {
    const result = await readSkillDirectory([file('sample/SKILL.md', '技能'), file('sample/references/a.md', '参考'), file('sample/.DS_Store', '系统元数据')])
    expect(result.files).toEqual({ 'sample/SKILL.md': '技能', 'sample/references/a.md': '参考' })
  })

  it('rejects traversal, duplicates and oversized packages before upload', async () => {
    await expect(readSkillDirectory([file('../SKILL.md', 'bad')])).rejects.toThrow('路径无效')
    await expect(readSkillDirectory([file('SKILL.md', 'a'), file('SKILL.md', 'b')])).rejects.toThrow('重复')
    await expect(readSkillDirectory([file('SKILL.md', '', 1024 * 1024 + 1)])).rejects.toThrow('1 MB')
    await expect(readSkillDirectory([file('SKILL.md', '', 256 * 1024 + 1)])).rejects.toThrow('256 KB')
    await expect(readSkillDirectory([])).rejects.toThrow('请选择')
  })

  it('accepts a package above the former limit with script and metadata attachments', async () => {
    const result = await readSkillDirectory([file('s/SKILL.md', 'a'.repeat(16000)), file('s/references/story.md', '参'.repeat(18000)), file('s/scripts/check.py', 'print(1)'), file('s/agents/openai.yaml', 'name: writer')])
    expect(Object.keys(result.files)).toHaveLength(4)
    expect(result.files['s/scripts/check.py']).toBe('print(1)')
  })

  it('encodes ZIP bytes and bounds the compressed upload', async () => {
    expect(await readSkillZip(file('skill.zip', 'PK'))).toEqual({ zip: 'UEs=' })
    await expect(readSkillZip(file('large.zip', '', 1024 * 1024 + 1))).rejects.toThrow('1 MB')
  })
})
