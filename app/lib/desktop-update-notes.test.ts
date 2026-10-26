import { describe, expect, it } from 'vitest'
import { buildCumulativeReleaseNotes, compareVersions } from './desktop-update-notes'

const note = (version: string, items: string[]) => ({
  version,
  notes: `版本：v${version}\n范围：v0 -> v${version}\n\n更新内容\n${items.map(item => `- ${item}`).join('\n')}\n`,
  pub_date: '2026-10-20T08:00:00Z'
})

describe('compareVersions', () => {
  it('compares numeric segments and prereleases', () => {
    expect(compareVersions('1.0.106', '1.0.100')).toBeGreaterThan(0)
    expect(compareVersions('v1.0.9', '1.0.10')).toBeLessThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.0.1-beta.1', '1.0.1')).toBeLessThan(0)
  })
})

describe('buildCumulativeReleaseNotes', () => {
  const rawJson = {
    releases: [
      note('1.0.106', ['f']),
      note('1.0.105', ['e']),
      note('1.0.101', ['a']),
      note('1.0.100', ['old']),
      note('1.0.107', ['future'])
    ]
  }

  it('merges every release after the installed version up to the target', () => {
    const result = buildCumulativeReleaseNotes('1.0.100', '1.0.106', rawJson, 'fallback')
    expect(result).toBe(
      'v1.0.106（2026-10-20）\n- f\n\nv1.0.105（2026-10-20）\n- e\n\nv1.0.101（2026-10-20）\n- a'
    )
  })

  it('falls back to the single body when the manifest has no history', () => {
    expect(buildCumulativeReleaseNotes('1.0.100', '1.0.106', { version: '1.0.106' }, 'fallback')).toBe('fallback')
    expect(buildCumulativeReleaseNotes('1.0.100', '1.0.106', undefined, 'fallback')).toBe('fallback')
  })
})
