import type { ScriptWritingStudio } from '#shared/types/script-writing'
import { buildScriptWritingPublication } from '#shared/types/script-writing'

function sanitizeFileName(value: string): string {
  const normalized = value.trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
  return normalized || 'AI创作剧本'
}

export function buildScriptWritingExportFileName(title: string, extension: 'txt' | 'docx', content: '剧本' | '大纲' = '剧本'): string {
  return `${sanitizeFileName(title)}-${content}.${extension}`
}

export function buildScriptWritingExportText(studio: ScriptWritingStudio): string {
  return buildScriptWritingPublication(studio).text
}

export function buildScriptWritingOutlineText(studio: ScriptWritingStudio): string {
  return [...studio.episodes]
    .sort((left, right) => left.index - right.index)
    .map(episode => [
      `第${episode.index}集 ${episode.title}`,
      `剧情概要：${episode.summary.trim() || '未填写'}`,
      `剧情节拍：\n${episode.beats.length ? episode.beats.map((beat, index) => `${index + 1}. ${beat}`).join('\n') : '未填写'}`,
      `结尾钩子：${episode.hook.trim() || '未填写'}`
    ].join('\n\n'))
    .join('\n\n')
}

export async function buildScriptWritingDocx(
  studio: ScriptWritingStudio,
  title: string
): Promise<Blob> {
  const {
    AlignmentType,
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    TextRun
  } = await import('docx')
  const draftedEpisodes = studio.episodes
    .filter(episode => episode.draft.trim())
    .sort((left, right) => left.index - right.index)
  if (draftedEpisodes.length === 0) throw new Error('没有可导出的单集剧本')

  function draftParagraphs(draft: string) {
    return draft.trim().split(/\r?\n/).map(line => new Paragraph({
      spacing: { after: line.trim() ? 100 : 40, line: 360 },
      children: [new TextRun({
        text: line || ' ',
        font: 'Microsoft YaHei',
        size: 22
      })]
    }))
  }

  const children = [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      heading: HeadingLevel.TITLE,
      spacing: { after: 180 },
      children: [new TextRun({ text: title.trim() || 'AI 创作剧本', bold: true, font: 'Microsoft YaHei' })]
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 480 },
      children: [new TextRun({
        text: `${studio.brief.genre} · ${draftedEpisodes.length} 集 · 单集约 ${studio.brief.episodeDuration} 秒`,
        color: '666666',
        font: 'Microsoft YaHei',
        size: 20
      })]
    })
  ]

  for (const episode of draftedEpisodes) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        pageBreakBefore: episode !== draftedEpisodes[0],
        spacing: { before: 240, after: 220 },
        children: [new TextRun({
          text: `第${episode.index}集 ${episode.title}`,
          bold: true,
          font: 'Microsoft YaHei'
        })]
      }),
      ...draftParagraphs(episode.draft)
    )
  }

  const document = new Document({
    creator: 'Playlet',
    title: title.trim() || 'AI 创作剧本',
    description: '由 Playlet AI 剧本创作工具导出',
    sections: [{
      properties: {
        page: {
          margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 }
        }
      },
      children
    }]
  })

  return await Packer.toBlob(document)
}

export function downloadScriptWritingBlob(blob: Blob, fileName: string) {
  if (typeof window === 'undefined') return
  const url = window.URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.style.display = 'none'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.URL.revokeObjectURL(url)
}
