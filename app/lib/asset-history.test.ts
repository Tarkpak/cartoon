import { describe, expect, it } from 'vitest'
import { ensureAssetHistoryEntry, normalizeAssetHistoryEntries } from './asset-history'

describe('asset history view mode', () => {
  it('stores single and four-view entries separately even when image url is same', () => {
    let history = ensureAssetHistoryEntry([], 'https://example.com/env.png', {
      source: 'generated',
      viewMode: '单视角',
      createdAt: '2026-05-13T10:00:00.000Z'
    })

    history = ensureAssetHistoryEntry(history, 'https://example.com/env.png', {
      source: 'generated',
      viewMode: '四视角',
      createdAt: '2026-05-13T10:05:00.000Z'
    })

    expect(history).toHaveLength(2)
    expect(history[0]?.viewMode).toBe('四视角')
    expect(history[1]?.viewMode).toBe('单视角')
  })

  it('deduplicates when image url and view mode are both the same', () => {
    let history = ensureAssetHistoryEntry([], 'https://example.com/env-single.png', {
      source: 'generated',
      viewMode: '单视角',
      createdAt: '2026-05-13T10:00:00.000Z'
    })

    history = ensureAssetHistoryEntry(history, 'https://example.com/env-single.png', {
      source: 'generated',
      viewMode: '单视角',
      createdAt: '2026-05-13T10:10:00.000Z'
    })

    expect(history).toHaveLength(1)
    expect(history[0]?.viewMode).toBe('单视角')
  })

  it('normalizes legacy + typed histories without collapsing different view modes', () => {
    const history = normalizeAssetHistoryEntries([
      {
        image: 'https://example.com/env-shared.png',
        viewMode: 'single',
        createdAt: '2026-05-13T10:00:00.000Z'
      },
      {
        image: 'https://example.com/env-shared.png',
        viewMode: 'four_view',
        createdAt: '2026-05-13T10:01:00.000Z'
      },
      {
        image: 'https://example.com/env-legacy.png',
        createdAt: '2026-05-13T09:59:00.000Z'
      }
    ])

    expect(history).toHaveLength(3)
    expect(history.some(entry => entry.viewMode === '单视角')).toBe(true)
    expect(history.some(entry => entry.viewMode === '四视角')).toBe(true)
    expect(history.some(entry => !entry.viewMode && entry.image.includes('legacy'))).toBe(true)
  })

  it('preserves the library asset id and version used by a project', () => {
    const history = ensureAssetHistoryEntry([], 'https://example.com/character-v2.png', {
      source: 'uploaded',
      libraryAssetId: 'lib_character',
      libraryAssetVersion: 2
    })

    expect(history[0]).toMatchObject({
      libraryAssetId: 'lib_character',
      libraryAssetVersion: 2
    })
    expect(normalizeAssetHistoryEntries(history)[0]).toMatchObject({
      libraryAssetId: 'lib_character',
      libraryAssetVersion: 2
    })
  })
})
