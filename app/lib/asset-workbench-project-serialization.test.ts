import { describe, expect, it } from 'vitest'
import { buildLoadedCharacters } from './asset-workbench-project-serialization'

describe('asset workbench project serialization', () => {
  it('loads character baseImage when imageUrl is empty', () => {
    const characters = buildLoadedCharacters([
      {
        id: 'char_1',
        name: '沈砚秋',
        appearance: '白衣画修',
        imageUrl: null,
        baseImage: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
      }
    ])

    expect(characters[0]?.baseImage).toBe('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB')
  })
})
