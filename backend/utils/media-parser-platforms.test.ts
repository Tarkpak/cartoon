import { describe, expect, test } from 'bun:test'
import { mediaParserPlatforms, parseMediaCookieInput } from './media-parser-platforms'

describe('media parser cookie settings', () => {
  test('accepts each supported platform and explicit clearing', () => {
    for (const { key } of mediaParserPlatforms) {
      expect(parseMediaCookieInput({ platform: key, cookie: ' session=value ' }))
        .toEqual({ platform: key, cookie: 'session=value' })
      expect(parseMediaCookieInput({ platform: key, cookie: '' }).cookie).toBe('')
    }
  })

  test('keeps the original Yuanbao settings request compatible', () => {
    expect(parseMediaCookieInput({ cookie: 'session=legacy' }).platform).toBe('yuanbao')
  })

  test('rejects unknown platforms, non-text values and unsafe headers', () => {
    for (const body of [
      { platform: '../../other', cookie: 'session=value' },
      { platform: 'xhs', cookie: null },
      { platform: 'xhs', cookie: 'session=value\r\nInjected: value' },
      { platform: 'xhs', cookie: 'x'.repeat(32769) }
    ]) {
      expect(() => parseMediaCookieInput(body)).toThrow()
    }
  })
})
