// Text that describes speech or thoughts must not introduce visual characters.
export interface SceneNonVisualRange { start: number, end: number }

export function collectSceneNonVisualRanges(text: string): SceneNonVisualRange[] {
  const ranges: SceneNonVisualRange[] = []
  const patterns = [
    /'[^'\n]*'|"[^"\n]*"|“[^”\n]*”|‘[^’\n]*’|「[^」\n]*」|『[^』\n]*』/gu,
    /[（(](?:[^）)\n]*(?:心理|心想|心声|内心|独白|暗想|盘算)[^）)\n]*|\s*\*\*[^）)\n]*[：:][^）)\n]*)[）)]/gu,
    /(?:【(?:台词|对白|对话|心理活动|内心独白|旁白|画外音)】|(?:台词|对白|对话|心理活动|内心独白|旁白|画外音)\s*[：:])[^\n]*/gu
  ]
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const start = match.index ?? 0
      // Keep the on-screen speaker outside the nonvisual range. For voiceover
      // and narration the whole label belongs to audio, including the speaker.
      const isDialogue = /^(?:【)?(?:台词|对白|对话)/u.test(match[0])
      const colon = isDialogue ? match[0].search(/[：:]/u) : -1
      ranges.push({ start: start + (colon >= 0 ? colon + 1 : 0), end: start + match[0].length })
    }
  }
  return ranges
}

/** Conservative: absent/ambiguous names remain eligible; only speech-only names are excluded. */
export function isCharacterOnlyMentionedOffscreen(description: string, name: string): boolean {
  const text = description.split('[引用资产]')[0] || ''
  const normalizedName = name.trim()
  if (!normalizedName) return false
  const ranges = collectSceneNonVisualRanges(text)
  let found = false
  let index = text.indexOf(normalizedName)
  while (index >= 0) {
    found = true
    if (!ranges.some(range => index >= range.start && index + normalizedName.length <= range.end)) return false
    index = text.indexOf(normalizedName, index + normalizedName.length)
  }
  return found
}
