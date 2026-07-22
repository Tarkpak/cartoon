export interface VideoImportRoleCandidate {
  id: string
  currentLabel: string
  name: string
  aliases: string[]
  source: 'stable' | 'legacy-placeholder' | 'legacy-role'
  legacyPlaceholder?: string
}

export interface VideoImportRoleRename {
  id: string
  currentLabel: string
  name: string
  source: VideoImportRoleCandidate['source']
  legacyPlaceholder?: string
}

const unknownRoleNames = new Set(['', '未明确', '未知', '不详', '无'])

function extractRoleSection(input: string): string {
  const header = /^##\s*角色\s*$/m.exec(input)
  if (!header) return ''
  const contentStart = header.index + header[0].length
  const remaining = input.slice(contentStart)
  const nextSection = /^##\s+/m.exec(remaining)
  return remaining.slice(0, nextSection?.index ?? remaining.length).trim()
}

function normalizeFieldName(value: string): string {
  return value.trim().replace(/\s+/g, '')
}

function normalizeRoleName(value: string | undefined): string {
  const normalized = value?.trim() || ''
  return unknownRoleNames.has(normalized) ? '' : normalized
}

function splitAliases(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(/[、,，/]/)
    .map(alias => alias.trim())
    .filter(alias => alias && !unknownRoleNames.has(alias))
}

function parseStableRoleCandidates(roleSection: string): VideoImportRoleCandidate[] {
  const candidates: VideoImportRoleCandidate[] = []
  for (const line of roleSection.split('\n')) {
    const parts = line.split(/[|｜]/).map(part => part.trim())
    const rawId = parts[0]?.replace(/^[-*]\s*/, '').trim() || ''
    if (!/^(?:角色\d+|role_\d+)$/i.test(rawId)) continue
    const id = rawId.toLowerCase()

    const fields = new Map<string, string>()
    for (const part of parts.slice(1)) {
      const match = /^([^：:]+)[：:]\s*(.*)$/.exec(part)
      if (!match) continue
      fields.set(normalizeFieldName(match[1]), match[2].trim())
    }
    const currentLabel = fields.get('当前称呼')?.trim() || ''
    if (!currentLabel) continue
    candidates.push({
      id,
      currentLabel,
      name: normalizeRoleName(fields.get('姓名')),
      aliases: splitAliases(fields.get('别名')),
      source: 'stable'
    })
  }
  return candidates
}

function parseLegacyPlaceholderCandidates(input: string): VideoImportRoleCandidate[] {
  const placeholders = new Set<string>()
  const patterns = [
    /角色\s*([A-Z])(?=\b|[：:，。、！？\s]|$)/g,
    /(?:^|\n)\s*([A-Z])(?=\s*[：:])/g
  ]
  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const placeholder = match[1]?.trim()
      if (placeholder) placeholders.add(placeholder)
    }
  }
  return Array.from(placeholders)
    .sort()
    .map(placeholder => ({
      id: `legacy_${placeholder.toLowerCase()}`,
      currentLabel: `角色${placeholder}`,
      name: '',
      aliases: [],
      source: 'legacy-placeholder' as const,
      legacyPlaceholder: placeholder
    }))
}

function parseLegacyRoleCandidates(roleSection: string): VideoImportRoleCandidate[] {
  const candidates: VideoImportRoleCandidate[] = []
  const seen = new Set<string>()
  for (const line of roleSection.split('\n')) {
    const match = /^(?:\d+[.、)]|[-*])\s+(.+?)\s*$/.exec(line)
    if (!match) continue
    const currentLabel = match[1]
      .replace(/^\*\*/, '')
      .replace(/\*\*.*$/, '')
      .split(/[：:]/, 1)[0]
      .trim()
    if (!currentLabel || /^角色\s*[A-Z]$/.test(currentLabel) || seen.has(currentLabel)) continue
    seen.add(currentLabel)
    candidates.push({
      id: `legacy_role_${candidates.length + 1}`,
      currentLabel,
      name: '',
      aliases: [],
      source: 'legacy-role'
    })
  }
  return candidates
}

export function parseVideoImportRoleCandidates(input: string): VideoImportRoleCandidate[] {
  const roleSection = extractRoleSection(input)
  const stableCandidates = parseStableRoleCandidates(roleSection)
  if (stableCandidates.length > 0) return stableCandidates

  const placeholderCandidates = parseLegacyPlaceholderCandidates(input)
  if (placeholderCandidates.length > 0) return placeholderCandidates
  return parseLegacyRoleCandidates(roleSection)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function updateStableRoleManifestLine(line: string, rename: VideoImportRoleRename): string {
  const roleLinePattern = new RegExp(`^\\s*[-*]\\s*${escapeRegExp(rename.id)}(?=\\s*[|｜])`, 'i')
  if (!roleLinePattern.test(line)) return line
  return line
    .replace(/(当前称呼\s*[：:]\s*)([^|｜\n]+)/, `$1${rename.name}`)
    .replace(/(姓名\s*[：:]\s*)([^|｜\n]+)/, `$1${rename.name}`)
}

function replaceLegacyPlaceholder(
  input: string,
  rename: VideoImportRoleRename,
  replacement: string
): string {
  const placeholder = rename.legacyPlaceholder?.trim()
  if (!placeholder) return input
  let output = input.replace(
    new RegExp(`角色\\s*${escapeRegExp(placeholder)}(?=\\b|[：:，。、！？\\s]|$)`, 'g'),
    replacement
  )
  output = output.replace(
    new RegExp(`(^|\\n)(\\s*)${escapeRegExp(placeholder)}(?=\\s*[：:])`, 'g'),
    `$1$2${replacement}`
  )
  return output
}

export function applyVideoImportRoleRenames(
  input: string,
  renames: VideoImportRoleRename[]
): string {
  const validRenames = renames
    .map(rename => ({
      ...rename,
      currentLabel: rename.currentLabel.trim(),
      name: rename.name.trim()
    }))
    .filter(rename => rename.currentLabel && rename.name)
    .sort((left, right) => right.currentLabel.length - left.currentLabel.length)

  const stableRenames = validRenames.filter(rename => rename.source === 'stable')
  const manifestLinePatterns = stableRenames.map(rename => ({
    rename,
    pattern: new RegExp(`^\\s*[-*]\\s*${escapeRegExp(rename.id)}(?=\\s*[|｜])`, 'i')
  }))
  let output = input
    .split('\n')
    .map((line) => {
      const manifestEntry = manifestLinePatterns.find(entry => entry.pattern.test(line))
      return manifestEntry ? updateStableRoleManifestLine(line, manifestEntry.rename) : line
    })
    .join('\n')

  const tokenizedRenames = validRenames.map((rename, index) => ({
    rename,
    token: `\uE000video_import_role_${index}\uE001`
  }))
  output = output
    .split('\n')
    .map((line) => {
      if (manifestLinePatterns.some(entry => entry.pattern.test(line))) return line
      let nextLine = line
      for (const { rename, token } of tokenizedRenames) {
        if (rename.source === 'legacy-placeholder') {
          nextLine = replaceLegacyPlaceholder(nextLine, rename, token)
        } else if (rename.currentLabel !== rename.name) {
          nextLine = nextLine.replace(new RegExp(escapeRegExp(rename.currentLabel), 'g'), token)
        }
      }
      return nextLine
    })
    .join('\n')

  for (const { rename, token } of tokenizedRenames) {
    output = output.replaceAll(token, rename.name)
  }
  return output
}
