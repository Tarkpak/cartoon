export interface ScriptWritingDiffPart {
  value: string
  added?: boolean
  removed?: boolean
}

export function diffScriptWritingLines(current: string, candidate: string): ScriptWritingDiffPart[] {
  const left = current ? current.split(/(?<=\n)/) : []
  const right = candidate ? candidate.split(/(?<=\n)/) : []
  const lengths = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1))

  for (let leftIndex = left.length - 1; leftIndex >= 0; leftIndex -= 1) {
    for (let rightIndex = right.length - 1; rightIndex >= 0; rightIndex -= 1) {
      lengths[leftIndex]![rightIndex] = left[leftIndex] === right[rightIndex]
        ? lengths[leftIndex + 1]![rightIndex + 1]! + 1
        : Math.max(lengths[leftIndex + 1]![rightIndex]!, lengths[leftIndex]![rightIndex + 1]!)
    }
  }

  const parts: ScriptWritingDiffPart[] = []
  let leftIndex = 0
  let rightIndex = 0
  while (leftIndex < left.length || rightIndex < right.length) {
    if (leftIndex < left.length && rightIndex < right.length && left[leftIndex] === right[rightIndex]) {
      parts.push({ value: left[leftIndex]! })
      leftIndex += 1
      rightIndex += 1
    } else if (rightIndex < right.length
      && (leftIndex >= left.length || lengths[leftIndex]![rightIndex + 1]! >= lengths[leftIndex + 1]![rightIndex]!)) {
      parts.push({ value: right[rightIndex]!, added: true })
      rightIndex += 1
    } else {
      parts.push({ value: left[leftIndex]!, removed: true })
      leftIndex += 1
    }
  }
  return parts
}
