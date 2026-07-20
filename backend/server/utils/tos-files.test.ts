import { describe, expect, test } from 'bun:test'
import { downloadContentDisposition } from './tos-files'

describe('TOS file downloads', () => {
  test('keeps unicode names through filename* with an ASCII fallback', () => {
    expect(downloadContentDisposition('成员图片 01.png')).toBe(
      'attachment; filename="_____01.png"; filename*=UTF-8\'\'%E6%88%90%E5%91%98%E5%9B%BE%E7%89%87%2001.png'
    )
  })

  test('removes line breaks from content disposition values', () => {
    const value = downloadContentDisposition('safe.png\r\nX-Test: injected')
    expect(value).not.toContain('\r')
    expect(value).not.toContain('\n')
    expect(value).toContain('safe.pngX-Test%3A%20injected')
  })
})
