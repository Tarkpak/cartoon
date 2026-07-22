import { describe, expect, test } from 'bun:test'
import { redactLogPayload } from './log-redaction'

describe('log payload redaction', () => {
  test('redacts sensitive headers and nested credentials', () => {
    expect(redactLogPayload({
      authorization: 'Bearer secret-token',
      headers: { 'x-api-key': 'key-value' },
      nested: [{ password: 'password-value', content: 'safe' }]
    })).toEqual({
      authorization: '[REDACTED]',
      headers: { 'x-api-key': '[REDACTED]' },
      nested: [{ password: '[REDACTED]', content: 'safe' }]
    })
  })

  test('redacts signed URL parameters while preserving the URL', () => {
    expect(redactLogPayload('https://cdn.example.com/image.png?signature=abc&width=1200'))
      .toBe('https://cdn.example.com/image.png?signature=%5BREDACTED%5D&width=1200')
  })
})
