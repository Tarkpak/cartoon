import type { SceneData } from './asset-workbench-models'

export interface SceneSplitPart { description: string, narration: string, duration: number }
export type SceneSplitDraft = [SceneSplitPart, SceneSplitPart]

const rangePattern = /([0-9]+(?:\.[0-9]+)?)\s*[-–—~～至]\s*([0-9]+(?:\.[0-9]+)?)\s*(?:秒|s)/gi

// Keep quoted dialogue together; punctuation inside quotations is not a boundary.
export function splitDescriptionUnits(text: string): string[] {
  const units: string[] = []
  let unit = ''
  let depth = 0
  let quoted = false
  const characters = [...text.trim()]
  for (const [index, char] of characters.entries()) {
    unit += char
    if (char === '"') quoted = !quoted
    if ('“「『'.includes(char)) depth++
    if ('”」』'.includes(char)) depth = Math.max(0, depth - 1)
    const period = char === '.' && !(/[0-9]/.test(characters[index - 1] || '') && /[0-9]/.test(characters[index + 1] || ''))
    const quoteEnd = '”」』"'.includes(char) && /[。！？!?]/.test(characters[index - 1] || '')
    if (depth === 0 && !quoted && ('。！？!?\n'.includes(char) || period || quoteEnd)) {
      if (unit.trim()) units.push(unit.trim())
      unit = ''
    }
  }
  if (unit.trim()) units.push(unit.trim())
  return units
}

export function normalizeSplitTimeline(text: string, duration: number): string {
  const ranges = [...text.matchAll(rangePattern)]
  if (!ranges.length) return text.trim()
  const start = Math.min(...ranges.map(match => Number(match[1])))
  const end = Math.max(...ranges.map(match => Number(match[2])))
  if (end <= start) return text.trim()
  const scale = (value: string) => Math.round(Math.max(0, Math.min(duration, (Number(value) - start) * duration / (end - start))) * 100) / 100
  return text.trim().replace(rangePattern, (_match, a: string, b: string) => `${scale(a)}-${scale(b)}秒`)
}

export function createSceneSplitDraft(scene: SceneData): SceneSplitDraft | null {
  if (!Number.isFinite(scene.duration) || scene.duration < 8) return null
  const units = splitDescriptionUnits(scene.description)
  if (units.length < 2) return null
  const total = units.reduce((sum, unit) => sum + unit.length, 0)
  let boundary = 1
  let best = Infinity
  let length = 0
  for (let i = 1; i < units.length; i++) {
    length += units[i - 1]!.length
    if (Math.abs(length - total / 2) < best) { boundary = i; best = Math.abs(length - total / 2) }
  }
  const descriptions = [units.slice(0, boundary).join('\n'), units.slice(boundary).join('\n')]
  const duration = Math.max(4, Math.min(scene.duration - 4, Math.round(scene.duration * descriptions[0]!.length / total)))
  // Narration placement requires a human choice; keep it visible on the first part.
  return [
    { description: normalizeSplitTimeline(descriptions[0]!, duration), narration: scene.narration || '', duration },
    { description: normalizeSplitTimeline(descriptions[1]!, scene.duration - duration), narration: '', duration: scene.duration - duration }
  ]
}
