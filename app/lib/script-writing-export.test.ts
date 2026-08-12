import { describe, expect, it } from 'vitest'
import { createEmptyScriptWritingStudio } from '#shared/types/script-writing'
import {
  buildScriptWritingDocx,
  buildScriptWritingExportFileName,
  buildScriptWritingExportText
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
