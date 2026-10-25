import { describe, expect, it } from 'vitest'
import { credentialHint, credentialState, featuredPlatforms, filterPlatformGroups } from './media-platforms'
import type { MediaPlatformCatalog } from './media-platforms'

const catalog: MediaPlatformCatalog = {
  total: 4,
  groups: [
    {
      key: 'video',
      label: '短视频',
      platforms: [
        { name: '抖音', credential: { env: 'DOUYIN_COOKIE', required: false, configured: false } },
        { name: '视频号', credential: { env: 'YUANBAO_COOKIE', required: true, configured: true } },
        { name: 'AcFun' }
      ]
    },
    { key: 'social', label: '图文社区', platforms: [{ name: '小红书', credential: { env: 'XHS_COOKIE', required: true, configured: false } }] }
  ]
}

describe('media platform catalog helpers', () => {
  it('describes credential requirements', () => {
    const [douyin, channels, acfun] = catalog.groups[0]!.platforms
    const xhs = catalog.groups[1]!.platforms[0]!
    expect([douyin, channels, acfun, xhs].map(p => credentialState(p!))).toEqual(['optional', 'configured', 'none', 'missing'])
    expect(credentialHint(xhs)).toContain('XHS_COOKIE')
    expect(credentialHint(acfun!)).toBe('无需登录凭据')
  })

  it('picks featured platforms in display order', () => {
    expect(featuredPlatforms(catalog).map(p => p.name)).toEqual(['抖音', '视频号', '小红书'])
  })

  it('filters by group and keyword, dropping empty groups', () => {
    expect(filterPlatformGroups(catalog.groups, 'social', '').map(g => g.key)).toEqual(['social'])
    const found = filterPlatformGroups(catalog.groups, 'all', 'acf')
    expect(found).toHaveLength(1)
    expect(found[0]!.platforms.map(p => p.name)).toEqual(['AcFun'])
    expect(filterPlatformGroups(catalog.groups, 'all', '不存在')).toEqual([])
  })
})
