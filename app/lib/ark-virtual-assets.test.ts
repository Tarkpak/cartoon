import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyArkVirtualAssetBinding,
  uploadArkVirtualAsset
} from './ark-virtual-assets'

describe('ark virtual assets', () => {
  const fetchMock = vi.fn()

  beforeEach(() => {
    fetchMock.mockReset()
    Object.defineProperty(globalThis, '$fetch', {
      configurable: true,
      value: fetchMock
    })
  })

  it('replaces an existing character image when binding another asset with the same name', () => {
    const character: { baseImage?: string, arkAsset?: Parameters<typeof applyArkVirtualAssetBinding>[1] } = {
      baseImage: 'https://example.com/old-yang.png'
    }
    const asset = {
      provider: 'volcengine' as const,
      libraryType: 'virtual_human' as const,
      projectName: 'default',
      groupId: 'group-1',
      assetId: 'asset-new-yang',
      assetType: 'Image' as const,
      sourceUrl: ' https://example.com/new-yang.png ',
      name: '杨巅峰',
      status: 'Active' as const
    }

    applyArkVirtualAssetBinding(character, asset)

    expect(character).toMatchObject({
      arkAsset: asset,
      baseImage: 'https://example.com/new-yang.png'
    })
  })

  it('clears a stale character image when the selected asset has no preview URL', () => {
    const character: { baseImage?: string, arkAsset?: Parameters<typeof applyArkVirtualAssetBinding>[1] } = {
      baseImage: 'https://example.com/old-yang.png'
    }
    const asset = {
      provider: 'volcengine' as const,
      libraryType: 'virtual_human' as const,
      projectName: 'default',
      groupId: 'group-1',
      assetId: 'asset-new-yang',
      assetType: 'Image' as const,
      name: '杨巅峰',
      status: 'Active' as const
    }

    applyArkVirtualAssetBinding(character, asset)

    expect(character.baseImage).toBeUndefined()
    expect(character.arkAsset?.assetId).toBe('asset-new-yang')
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

  it('records the credential fingerprint on newly uploaded assets', async () => {
    fetchMock.mockResolvedValue({
      success: true,
      data: {
        credentialFingerprint: 'ak1_current',
        asset: {
          Id: 'asset-new',
          GroupId: 'group-new',
          Status: 'Processing',
          ProjectName: 'default'
        }
      }
    })

    const asset = await uploadArkVirtualAsset({
      groupId: 'group-new',
      name: '新账号素材',
      sourceUrl: 'https://example.com/new.png'
    })

    expect(asset.credentialFingerprint).toBe('ak1_current')
  })
})
