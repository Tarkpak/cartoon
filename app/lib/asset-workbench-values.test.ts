import { describe, expect, it, vi } from 'vitest'
import { getDisplayErrorMessage } from './asset-workbench-values'

describe('getDisplayErrorMessage', () => {
  it('prefers the server message', () => {
    expect(getDisplayErrorMessage({ data: { message: '项目不存在' } }, '打开失败')).toBe('项目不存在')
  })

  it('hides internal database errors behind the fallback', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = { data: { message: 'Invalid column type Null at index: 0, name: owner_user_id' } }
    expect(getDisplayErrorMessage(error, '项目打开失败，请重试')).toBe('项目打开失败，请重试')
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('hides raw fetch errors behind the fallback', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const error = { message: '[POST] "/api/project/x/collaboration/prepare": 500 Internal Server Error' }
    expect(getDisplayErrorMessage(error, '项目打开失败，请重试')).toBe('项目打开失败，请重试')
    vi.restoreAllMocks()
  })

  it('uses the fallback when there is no message', () => {
    expect(getDisplayErrorMessage(undefined, '操作失败')).toBe('操作失败')
  })
})
