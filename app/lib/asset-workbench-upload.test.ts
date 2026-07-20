import { describe, expect, it } from 'vitest'
import { resolveImageFileMimeType } from './asset-workbench-upload'

describe('asset workbench image upload', () => {
  it('uses the browser-reported image MIME type', () => {
    expect(resolveImageFileMimeType({
      name: 'environment.bin',
      type: 'image/webp'
    })).toBe('image/webp')
  })

  it('infers common generated image types when the desktop runtime omits MIME', () => {
    expect(resolveImageFileMimeType({
      name: 'environment-9x16.JPG',
      type: ''
    })).toBe('image/jpeg')
    expect(resolveImageFileMimeType({
      name: 'environment-9x16.webp',
      type: 'application/octet-stream'
    })).toBe('image/webp')
  })

  it('rejects files that are not recognizable images', () => {
    expect(resolveImageFileMimeType({
      name: 'environment.zip',
      type: 'application/octet-stream'
    })).toBeUndefined()
  })
})
