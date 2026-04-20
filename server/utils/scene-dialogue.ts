const SCENE_ASSET_MENTION_SECTION_REGEX = /\n{0,2}\[引用资产\]\n(?:@[^\n]*\n?)*$/u
const NO_DIALOGUE_HINT_REGEX = /(?:无对白|无台词|不要对白|不说话|静音|silent|no\s+dialogue)/iu
const EXPLICIT_DIALOGUE_LABEL_REGEX = /(?:对白|台词|对话)\s*[：:]/u
const EXPLICIT_DIALOGUE_LABEL_CAPTURE_REGEX = /(?:对白|台词|对话)\s*[：:]\s*(.+)$/u
const QUOTED_DIALOGUE_REGEX = /[“"‘'][^”"’'\n]{1,120}[”"’']/u
const TIMELINE_PREFIX_REGEX = /^\s*\d+(?:\.\d+)?\s*-\s*\d+(?:\.\d+)?(?:s|秒)\s*[：:]\s*/u
const SPEAKER_LINE_REGEX = /^([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·._\-（）()]{0,20})\s*[：:]\s*(.+)$/u
const SPEAKER_DIALOGUE_PAIR_REGEX = /([\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·._\-（）()]{0,20})\s*[：:]\s*(.+?)(?=(?:\s*[；;]\s*[\p{Script=Han}A-Za-z][\p{Script=Han}A-Za-z0-9·._\-（）()]{0,20}\s*[：:])|$)/gu

const NON_SPEAKER_LABEL_SET = new Set([
  '镜头',
  '画面',
  '场景',
  '环境',
  '动作',
  '声音',
  '音效',
  '旁白',
  '机位',
  '运镜',
  '光线',
  '色调',
  '构图',
  '节奏',
  '表演',
  '情绪',
  '提示',
  '备注',
  '时间',
  '地点'
])

function stripSceneAssetMentionSection(text: string): string {
  return text.replace(SCENE_ASSET_MENTION_SECTION_REGEX, '').trimEnd()
}

export interface SceneDialogueItem {
  character: string
  text: string
}

function normalizeDialogueText(value: string): string {
  const normalized = value.trim()
  if (!normalized) return ''

  const wrapped = normalized.match(/^[“"‘'](.+)[”"’']$/u)
  if (wrapped?.[1]) {
    return wrapped[1].trim()
  }

  return normalized
}

function extractDialoguesFromSpeakerPairs(raw: string): SceneDialogueItem[] {
  const dialogues: SceneDialogueItem[] = []

  for (const match of raw.matchAll(SPEAKER_DIALOGUE_PAIR_REGEX)) {
    const speaker = (match[1] || '').trim()
    const utterance = normalizeDialogueText(match[2] || '')
    if (!speaker || !utterance) continue
    if (NON_SPEAKER_LABEL_SET.has(speaker)) continue

    dialogues.push({
      character: speaker,
      text: utterance
    })
  }

  return dialogues
}

function extractDialoguesFromLine(rawLine: string): SceneDialogueItem[] {
  const line = rawLine.trim()
  if (!line) return []

  const text = line.replace(TIMELINE_PREFIX_REGEX, '').trim()
  if (!text) return []

  const explicitDialogueMatch = text.match(EXPLICIT_DIALOGUE_LABEL_CAPTURE_REGEX)
  if (explicitDialogueMatch?.[1]) {
    return extractDialoguesFromSpeakerPairs(explicitDialogueMatch[1])
  }

  return extractDialoguesFromSpeakerPairs(text)
}

/**
 * 从场景描述中提取结构化对白（角色名 + 台词）。
 * 仅当存在明确的“角色: 台词”片段时才提取，避免把镜头说明误判为对白。
 */
export function extractSceneDialoguesFromDescription(description?: string): SceneDialogueItem[] {
  const text = stripSceneAssetMentionSection(description?.trim() || '')
  if (!text) return []
  if (NO_DIALOGUE_HINT_REGEX.test(text)) return []

  const seen = new Set<string>()
  const result: SceneDialogueItem[] = []

  for (const line of text.split('\n')) {
    const dialogues = extractDialoguesFromLine(line)
    for (const item of dialogues) {
      const key = `${item.character}::${item.text}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push(item)
    }
  }

  return result
}

function hasDialogueClueInLine(rawLine: string): boolean {
  const line = rawLine.trim()
  if (!line) return false

  const text = line.replace(TIMELINE_PREFIX_REGEX, '').trim()
  if (!text) return false

  if (EXPLICIT_DIALOGUE_LABEL_REGEX.test(text)) return true
  if (QUOTED_DIALOGUE_REGEX.test(text)) return true

  const speakerLineMatch = text.match(SPEAKER_LINE_REGEX)
  if (!speakerLineMatch?.[1] || !speakerLineMatch[2]) return false

  const speaker = speakerLineMatch[1].trim()
  const utterance = speakerLineMatch[2].trim()
  if (!speaker || !utterance) return false
  if (NON_SPEAKER_LABEL_SET.has(speaker)) return false

  return true
}

/**
 * 场景描述是否仍包含对白线索。
 * - true: 说明描述中包含对白意图
 * - false: 说明该场景不应按对白驱动
 */
export function shouldIncludeSceneDialoguesFromDescription(description?: string): boolean {
  const text = stripSceneAssetMentionSection(description?.trim() || '')
  if (!text) return false
  if (NO_DIALOGUE_HINT_REGEX.test(text)) return false

  return text
    .split('\n')
    .some(line => hasDialogueClueInLine(line))
}
