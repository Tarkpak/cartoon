import { describe, expect, it } from 'vitest'
import {
  auditActionLabel,
  creditTransactionTypeLabel,
  mediaDirectionLabel,
  mediaTypeLabel,
  modelOperationLabel,
  modelStatusLabel,
  statusLabel,
  userRoleLabel
} from './display-labels'

describe('display enum labels', () => {
  it('translates model log and media enums', () => {
    expect(modelOperationLabel('generateImage')).toBe('图片生成')
    expect(modelStatusLabel('success')).toBe('成功')
    expect(mediaTypeLabel('audio')).toBe('音频')
    expect(mediaDirectionLabel('response')).toBe('响应')
  })

  it('keeps unknown values visible and translates user roles', () => {
    expect(userRoleLabel('admin')).toBe('管理员')
    expect(modelOperationLabel('futureOperation')).toBe('futureOperation')
  })

  it('translates shared business and audit enums', () => {
    expect(statusLabel('in_progress')).toBe('进行中')
    expect(statusLabel('Active')).toBe('已启用')
    expect(creditTransactionTypeLabel('model_call')).toBe('模型调用')
    expect(auditActionLabel('admin.users.reset_password')).toBe('重置用户密码')
  })
})
