export interface MediaPlatformCredential {
  env: string
  required: boolean
  configured: boolean
}

export interface MediaPlatform {
  name: string
  credential?: MediaPlatformCredential
}

export interface MediaPlatformGroup {
  key: string
  label: string
  platforms: MediaPlatform[]
}

export interface MediaPlatformCatalog {
  total: number
  groups: MediaPlatformGroup[]
}

export interface MediaPlatformDetection {
  url: string | null
  platform: MediaPlatform | null
}

export type CredentialState = 'none' | 'configured' | 'optional' | 'missing'

/** Platforms shown in the collapsed summary, in display order. */
export const FEATURED_PLATFORMS = ['抖音', '快手', '视频号', '小红书', '哔哩哔哩', '微博', '西瓜视频', '网易云音乐']

export function credentialState(platform: MediaPlatform): CredentialState {
  const credential = platform.credential
  if (!credential) return 'none'
  if (credential.configured) return 'configured'
  return credential.required ? 'missing' : 'optional'
}

export function credentialHint(platform: MediaPlatform): string {
  const credential = platform.credential
  switch (credentialState(platform)) {
    case 'configured':
      return `已配置 ${credential!.env}`
    case 'missing':
      return `通常需要在 .env 配置 ${credential!.env} 后才能解析`
    case 'optional':
      return `可在云后台「系统设置 → 媒体解析凭据」或本机 .env 配置 ${credential!.env} 提高成功率`
    default:
      return '无需登录凭据'
  }
}

export function featuredPlatforms(catalog: MediaPlatformCatalog): MediaPlatform[] {
  const all = catalog.groups.flatMap(group => group.platforms)
  return FEATURED_PLATFORMS
    .map(name => all.find(platform => platform.name === name))
    .filter((platform): platform is MediaPlatform => Boolean(platform))
}

export function filterPlatformGroups(groups: MediaPlatformGroup[], groupKey: string, keyword: string): MediaPlatformGroup[] {
  const query = keyword.trim().toLowerCase()
  return groups
    .filter(group => groupKey === 'all' || group.key === groupKey)
    .map(group => ({
      ...group,
      platforms: query ? group.platforms.filter(platform => platform.name.toLowerCase().includes(query)) : group.platforms
    }))
    .filter(group => group.platforms.length > 0)
}
