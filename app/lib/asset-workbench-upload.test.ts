import { describe, expect, it } from 'vitest'
import { detectUploadMediaKind, resolveAudioFileMimeType, resolveImageFileMimeType } from './asset-workbench-upload'

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

describe('asset workbench unified media upload', () => {
  it('detects media kind from the reported MIME type', () => {
    expect(detectUploadMediaKind({ name: 'a.bin', type: 'image/png' })).toBe('image')
    expect(detectUploadMediaKind({ name: 'a.bin', type: 'audio/mpeg' })).toBe('voice')
    expect(detectUploadMediaKind({ name: 'a.bin', type: 'video/mp4' })).toBe('video')
  })

  it('falls back to the file extension when MIME is missing', () => {
    expect(detectUploadMediaKind({ name: 'ref.JPG', type: '' })).toBe('image')
    expect(detectUploadMediaKind({ name: 'narration.m4a', type: 'application/octet-stream' })).toBe('voice')
    expect(detectUploadMediaKind({ name: 'fight.mov', type: '' })).toBe('video')
    expect(resolveAudioFileMimeType({ name: 'voice.wav', type: '' })).toBe('audio/wav')
  })

  it('rejects unsupported files', () => {
    expect(detectUploadMediaKind({ name: 'notes.txt', type: 'text/plain' })).toBeUndefined()
  })
})
