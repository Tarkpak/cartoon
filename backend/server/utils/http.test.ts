import { describe, expect, it, spyOn } from 'bun:test'
import { requiredString } from './http'

describe('requiredString error details', () => {
  it('returns a trimmed valid value', () => {
    expect(requiredString('  value  ', '名称')).toBe('value')
  })

  it('preserves Unicode details without putting them in the HTTP status message', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      for (const value of ['', 'too long']) {
        let error: unknown
        try {
          requiredString(value, '名称\n详情', 3)
        } catch (cause) {
          error = cause
        }
        expect(error).toMatchObject({
          statusCode: 400,
          message: value ? '名称\n详情 is too long' : '名称\n详情 is required'
        })
        expect((error as { statusMessage?: string }).statusMessage).toBeUndefined()
      }
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
