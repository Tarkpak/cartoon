import { beforeEach, describe, expect, it, vi } from 'vitest'
import { uploadArkVirtualAsset } from './ark-virtual-assets'

describe('ark virtual assets', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    Object.defineProperty(globalThis, '$fetch', {
      configurable: true,
      value: fetchMock
    })
  })

  it('surfaces the backend message when an upload request fails', async () => {
    fetchMock.mockRejectedValue(Object.assign(
      new Error('[POST] "/api/ark-assets/virtual/assets/upload": 400 Bad Request'),
      {
        data: {
          success: false,
          message: '火山素材库需要公网可访问 URL，请先启用 TOS 云存储配置'
        }
      }
    ))

    await expect(uploadArkVirtualAsset({
      groupId: 'group-1',
      name: 'character',
      imageData: 'data:image/png;base64,AAAA'
    })).rejects.toThrow('火山素材库需要公网可访问 URL，请先启用 TOS 云存储配置')
  })
})
