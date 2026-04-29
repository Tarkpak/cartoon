import { z } from 'zod'
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  TextRun
} from 'docx'
import {
  buildScriptDocxFileName,
  normalizeScriptDocxScenes,
  type ScriptDocxSceneInput
} from '../../utils/script-docx-export'

const SceneSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  narration: z.string().nullish(),
  duration: z.number().optional(),
  setting: z.object({
    location: z.string().optional(),
    timeOfDay: z.string().optional()
  }).nullish(),
  characters: z.array(z.object({
    name: z.string().optional()
  })).optional(),
  dialogues: z.array(z.object({
    character: z.string().optional(),
    text: z.string().optional()
  })).optional()
})

const ExportScriptDocxSchema = z.object({
  projectName: z.string().optional(),
  scenes: z.array(SceneSchema).min(1),
  includeDialoguesFromDescription: z.boolean().optional()
})

function formatDuration(seconds: number): string {
  const normalized = Math.round(Math.max(0, seconds) * 10) / 10
  return Number.isInteger(normalized)
    ? String(normalized)
    : normalized.toFixed(1).replace(/\.0$/, '')
}

function resolveContentLines(text: string): string[] {
  if (!text) return []

  const lines = text
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)

  if (lines.length > 0) return lines
  return [text.trim()].filter(Boolean)
}

function buildSceneParagraphs(
  scene: ReturnType<typeof normalizeScriptDocxScenes>[number],
  index: number
): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      text: `场景 ${index + 1}：${scene.title}`,
      heading: HeadingLevel.HEADING_2
    })
  ]

  const metaParts: string[] = []
  if (scene.location) metaParts.push(`地点：${scene.location}`)
  if (scene.timeOfDay) metaParts.push(`时间：${scene.timeOfDay}`)
  if (scene.duration !== null) metaParts.push(`时长：${formatDuration(scene.duration)} 秒`)
  if (metaParts.length > 0) {
    paragraphs.push(new Paragraph({ text: metaParts.join('  ｜  ') }))
  }

  if (scene.characters.length > 0) {
    paragraphs.push(new Paragraph({
      text: `角色：${scene.characters.join('、')}`
    }))
  }

  if (scene.description) {
    paragraphs.push(new Paragraph({
      text: '场景描述',
      heading: HeadingLevel.HEADING_3
    }))
    for (const line of resolveContentLines(scene.description)) {
      paragraphs.push(new Paragraph({ text: line }))
    }
  }

  if (scene.narration) {
    paragraphs.push(new Paragraph({
      text: '旁白',
      heading: HeadingLevel.HEADING_3
    }))
    for (const line of resolveContentLines(scene.narration)) {
      paragraphs.push(new Paragraph({
        children: [new TextRun({ text: line, italics: true })]
      }))
    }
  }

  if (scene.dialogues.length > 0) {
    paragraphs.push(new Paragraph({
      text: '对白',
      heading: HeadingLevel.HEADING_3
    }))
    for (const dialogue of scene.dialogues) {
      paragraphs.push(new Paragraph({
        text: `${dialogue.character}：${dialogue.text}`,
        bullet: { level: 0 }
      }))
    }
  }

  paragraphs.push(new Paragraph({ text: '' }))
  return paragraphs
}

export default defineEventHandler(async (event) => {
  const body = await readBody(event)
  const parseResult = ExportScriptDocxSchema.safeParse(body)

  if (!parseResult.success) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: parseResult.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join(', ')
    })
  }

  const payload = parseResult.data
  const normalizedScenes = normalizeScriptDocxScenes(payload.scenes as ScriptDocxSceneInput[], {
    includeDialoguesFromDescription: payload.includeDialoguesFromDescription
  })

  if (normalizedScenes.length === 0) {
    throw createError({
      statusCode: 400,
      statusMessage: 'Bad Request',
      message: '没有可导出的场景',
    })
  }

  try {
    const projectName = payload.projectName?.trim() || '剧本检视稿'
    const generatedAt = new Date().toLocaleString('zh-CN', {
      hour12: false
    })
    const children: Paragraph[] = [
      new Paragraph({
        text: `${projectName} - 格式化剧本`,
        heading: HeadingLevel.TITLE
      }),
      new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [
          new TextRun({
            text: `导出时间：${generatedAt}`,
            color: '666666'
          })
        ]
      }),
      new Paragraph({ text: '' })
    ]

    for (const [index, scene] of normalizedScenes.entries()) {
      children.push(...buildSceneParagraphs(scene, index))
    }

    const document = new Document({
      sections: [
        {
          children
        }
      ]
    })
    const buffer = await Packer.toBuffer(document)
    const fileName = buildScriptDocxFileName(payload.projectName)

    setHeader(event, 'Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    setHeader(event, 'Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`)

    return buffer
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'statusCode' in error) {
      throw error
    }

    console.error('[script-docx] 导出失败:', error)
    throw createError({
      statusCode: 500,
      statusMessage: 'Internal Server Error',
      message: error instanceof Error ? error.message : '未知错误'
    })
  }
})
