import { describe, expect, it } from 'vitest'
import { createEmptyScriptWritingStudio } from '#shared/types/script-writing'
import {
  buildScriptWritingDocx,
  buildScriptWritingExportFileName,
  buildScriptWritingExportText,
  buildScriptWritingOutlineText
} from './script-writing-export'

describe('script writing export', () => {
  it('exports only drafted episodes in episode order', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.episodes = [
      { id: '2', index: 2, title: '反转', summary: '', hook: '', beats: [], draft: '第二集正文', review: '' },
      { id: '1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '第一集正文', review: '' },
      { id: '3', index: 3, title: '结局', summary: '', hook: '', beats: [], draft: ' ', review: '' }
    ]

    expect(buildScriptWritingExportText(studio))
      .toBe('第1集 开局\n\n第一集正文\n\n第2集 反转\n\n第二集正文')
  })

  it('exports outline fields in order even when episodes have no drafts', () => {
    const studio = createEmptyScriptWritingStudio()
    studio.episodes = [
      { id: '2', index: 2, title: '反转', summary: '查到证据', hook: '幕后黑手现身', beats: ['追踪', '对峙'], draft: '不导出正文', review: '' },
      { id: '1', index: 1, title: '开局', summary: '主角登场', hook: '', beats: [], draft: '', review: '' }
    ]
    const text = buildScriptWritingOutlineText(studio)
    expect(text.indexOf('第1集 开局')).toBeLessThan(text.indexOf('第2集 反转'))
    expect(text).toContain('剧情概要：查到证据')
    expect(text).toContain('1. 追踪\n2. 对峙')
    expect(text).toContain('结尾钩子：幕后黑手现身')
    expect(text).toContain('结尾钩子：未填写')
    expect(text).not.toContain('不导出正文')
    expect(studio.episodes[0]?.id).toBe('2')
    expect(buildScriptWritingExportFileName('升学宴', 'txt', '大纲')).toBe('升学宴-大纲.txt')
  })

  it('returns an empty outline for an empty project', () => {
    expect(buildScriptWritingOutlineText(createEmptyScriptWritingStudio())).toBe('')
  })

  it('sanitizes file names for browser downloads', () => {
    expect(buildScriptWritingExportFileName('  我的/剧本:终稿  ', 'docx'))
      .toBe('我的-剧本-终稿-剧本.docx')
    expect(buildScriptWritingExportFileName('', 'txt')).toBe('AI创作剧本-剧本.txt')
  })

  it('builds a non-empty DOCX archive for drafted episodes', async () => {
    const studio = createEmptyScriptWritingStudio()
    studio.episodes = [
      { id: '1', index: 1, title: '开局', summary: '', hook: '', beats: [], draft: '第一场\n林默：证据在哪里？', review: '' }
    ]

    const blob = await buildScriptWritingDocx(studio, '失忆律师')
    const signature = new Uint8Array(await blob.slice(0, 2).arrayBuffer())
    expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    expect(blob.size).toBeGreaterThan(1000)
    expect(Array.from(signature)).toEqual([0x50, 0x4B])
  })
})
