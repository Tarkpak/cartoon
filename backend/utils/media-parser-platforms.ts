export const mediaParserPlatforms = [
  { key: 'yuanbao', label: '视频号 / 腾讯元宝', env: 'YUANBAO_COOKIE', site: 'yuanbao.tencent.com' },
  { key: 'xhs', label: '小红书', env: 'XHS_COOKIE', site: 'www.xiaohongshu.com' },
  { key: 'pinduoduo', label: '拼多多', env: 'PINDUODUO_COOKIE', site: 'mobile.yangkeduo.com' },
  { key: 'douyin', label: '抖音', env: 'DOUYIN_COOKIE', site: 'www.douyin.com' },
  { key: 'kuaishou', label: '快手', env: 'KUAISHOU_COOKIE', site: 'www.kuaishou.com' },
  { key: 'weibo', label: '微博', env: 'WEIBO_COOKIE', site: 'weibo.com' },
  { key: 'doubao', label: '豆包', env: 'DOUBAO_COOKIE', site: 'www.doubao.com' },
  { key: 'jimeng', label: '即梦 AI', env: 'JIMENG_COOKIE', site: 'jimeng.jianying.com' }
] as const

export type MediaParserPlatformKey = typeof mediaParserPlatforms[number]['key']

export function parseMediaCookieInput(body: { platform?: unknown, cookie?: unknown }) {
  // Preserve compatibility with the original Yuanbao-only settings endpoint.
  const platform = body.platform === undefined ? 'yuanbao' : body.platform
  if (!mediaParserPlatforms.some(item => item.key === platform)) {
    throw new Error('不支持的媒体解析平台')
  }
  if (typeof body.cookie !== 'string' || body.cookie.length > 32768 || /[\r\n]/.test(body.cookie)) {
    throw new Error('Cookie 必须为不超过 32768 字符的单行文本')
  }
  return { platform: platform as MediaParserPlatformKey, cookie: body.cookie.trim() }
}
