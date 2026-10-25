// API responses are mocked: this checks UI behavior without touching real user data.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const executable = process.env.AGENT_BROWSER || 'agent-browser'
function browser(...args) {
  return execFileSync(executable, ['--session', 'cartoon-media-qa', ...args], { encoding: 'utf8', timeout: 30000 })
}
function mock(pattern, payload) {
  browser('network', 'route', pattern, '--body', JSON.stringify(payload))
}
const auth = { success: true, data: { authenticated: true, configured: true, user: { id: 'qa', role: 'admin', displayName: '测试用户' } } }
function parseResponse(payload) {
  // agent-browser routes match in registration order; keep the catch-all last.
  browser('network', 'unroute', '**/api/**')
  browser('network', 'unroute', '**/api/tools/short-video/parse')
  mock('**/api/tools/short-video/parse', payload)
  mock('**/api/**', auth)
}
function parseMock(profile) { parseResponse({ success: true, data: profile }) }
function reference(snapshot, text) {
  const line = snapshot.split('\n').find(line => line.includes(text))
  assert.ok(line, `Missing ${text}: ${snapshot}`)
  return `@${line.match(/ref=(e\d+)/)[1]}`
}
const profile = {
  historyId: 'mp_qa', platform: 'xiaohongshu', platformName: '小红书',
  sourceUrl: 'https://www.xiaohongshu.com/explore/qa', title: '小红书视频及完整素材', mediaType: 'video',
  videoUrl: 'https://cdn.example/video.mp4', videoUrls: ['https://cdn.example/video.mp4', 'https://cdn.example/second.mp4'],
  coverUrl: '', imageUrls: ['https://cdn.example/image.jpg'], audioUrl: 'https://cdn.example/audio.mp3',
  livePhotos: [{ imageIndex: 0, url: 'https://cdn.example/live.mp4' }],
  subtitles: [{ start: 0, end: 1, text: '字幕' }]
}
try {
  await Promise.resolve(browser('open', 'about:blank'))
  mock('**/api/**', { success: true, data: { authenticated: true, configured: true, user: { id: 'qa', role: 'admin', displayName: '测试用户' } } })
  mock('**/api/tools/short-video/history', { success: true, data: { items: [] } })
  mock('**/api/tools/short-video/download', { success: true, data: { profile, path: '/tmp/qa.srt', filename: 'qa.srt', downloadDir: '/tmp', sizeBytes: 20 } })
  parseMock(profile)
  browser('open', `${process.env.MEDIA_QA_URL || 'http://localhost:3000'}/tools/short-video-download`)
  let snapshot = browser('snapshot', '-i')
  browser('fill', reference(snapshot, 'textbox "分享链接"'), profile.sourceUrl)
  snapshot = browser('snapshot', '-i')
  browser('click', reference(snapshot, 'button "解析作品"'))
  browser('wait', '--text', '更多素材')
  snapshot = browser('snapshot', '-i')
  for (const label of ['下载视频 1', '下载视频 2', '下载全部图片', '下载实况视频', '下载音频', '下载字幕']) {
    assert.ok(snapshot.includes(label), `Missing ${label}`)
  }
  assert.equal(browser('eval', 'document.querySelectorAll("video").length').trim(), '1')
  browser('click', reference(snapshot, '下载字幕'))
  browser('wait', '--text', 'qa.srt')
  browser('screenshot', join(tmpdir(), 'cartoon-media-resources.png'))

  // Pure audio from another upstream platform has a player and no video element.
  parseMock({ ...profile, platform: 'mediaParser', platformName: '网易云音乐', mediaType: 'audio', videoUrl: '', videoUrls: [], imageUrls: [], livePhotos: [], subtitles: [] })
  snapshot = browser('snapshot', '-i')
  browser('click', reference(snapshot, 'button "解析作品"'))
  browser('wait', 'audio')
  assert.equal(browser('eval', 'document.querySelectorAll("audio").length').trim(), '1')
  assert.equal(browser('eval', 'document.querySelectorAll("video").length').trim(), '0')
  assert.ok(browser('snapshot').includes('网易云音乐'))

  parseMock({ ...profile, mediaType: 'image', videoUrl: '', videoUrls: [], audioUrl: null })
  snapshot = browser('snapshot', '-i')
  browser('click', reference(snapshot, 'button "解析作品"'))
  browser('wait', '--fn', 'document.querySelectorAll("img").length > 0 && document.querySelectorAll("audio,video").length === 0')
  assert.ok(browser('snapshot', '-i').includes('下载全部图片'))

  parseMock({ platform: 'wxChannels', platformName: '视频号', title: '统一视频号路径', mediaType: 'video', sourceUrl: 'https://weixin.qq.com/sph/qa', videoUrl: 'https://cdn.example/wx.mp4', coverUrl: '' })
  snapshot = browser('snapshot', '-i')
  browser('click', reference(snapshot, 'button "解析作品"'))
  browser('wait', '--text', '统一视频号路径')
  assert.ok(browser('eval', 'document.querySelector("video").getAttribute("src")').includes('/api/tools/short-video/preview?url='))

  // Structured engine failures reach the error UI without stale resources.
  parseResponse({ success: false, message: '需要有效小红书 Cookie' })
  snapshot = browser('snapshot', '-i')
  browser('click', reference(snapshot, 'button "解析作品"'))
  browser('wait', '--text', '需要有效小红书 Cookie')
  assert.equal(browser('eval', 'document.querySelectorAll("audio,video").length').trim(), '0')
  assert.equal(browser('errors').trim(), '')
  console.log('PASS: Xiaohongshu video, all resource buttons, subtitle download, audio/image platforms, unified video channels and failure states')
} catch (error) {
  console.error(browser('snapshot'))
  console.error(browser('errors'))
  console.error(browser('console'))
  throw error
} finally {
  browser('close')
}
