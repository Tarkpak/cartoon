import { TosClient } from '@volcengine/tos-sdk'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(root, '.env')
const downloadTimeoutMs = 120_000
const multipartThreshold = 5 * 1024 * 1024
const multipartPartSize = 5 * 1024 * 1024
const transferConcurrency = 2
const maxTransferAttempts = 3

function loadEnvFile(path) {
  if (!existsSync(path)) return

  const content = readFileSync(path, 'utf8')
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^\s*([^#=\s][^=]*)=(.*)$/)
    if (!match) continue

    const key = match[1].trim()
    const value = match[2].trim()
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
}

function env(key) {
  const value = process.env[key]?.trim()
  return value || ''
}

function requiredEnv(key) {
  const value = env(key)
  if (!value) {
    throw new Error(`${key} is required`)
  }
  return value
}

function trimSlashes(value) {
  return value.replace(/^\/+|\/+$/g, '')
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/g, '')
}

function joinPath(...parts) {
  return parts.map(trimSlashes).filter(Boolean).join('/')
}

function joinUrl(baseUrl, path) {
  const encodedPath = joinPath(path)
    .split('/')
    .map(encodeURIComponent)
    .join('/')
  return `${normalizeBaseUrl(baseUrl)}/${encodedPath}`
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatDuration(startedAt) {
  return `${((Date.now() - startedAt) / 1000).toFixed(1)}s`
}

async function retry(label, operation) {
  let lastError

  for (let attempt = 1; attempt <= maxTransferAttempts; attempt += 1) {
    try {
      return await operation(attempt)
    }
    catch (error) {
      lastError = error
      if (attempt === maxTransferAttempts) break

      const delayMs = attempt * 1_000
      const message = error instanceof Error ? error.message : String(error)
      console.warn(`${label} failed (attempt ${attempt}/${maxTransferAttempts}): ${message}`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  throw lastError
}

async function mapWithConcurrency(items, concurrency, operation) {
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      await operation(items[index])
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  )
}

function buildTosPublicBaseUrl() {
  const publicBaseUrl = env('TOS_PUBLIC_BASE_URL')
  if (publicBaseUrl) return normalizeBaseUrl(publicBaseUrl)

  const bucket = env('TOS_BUCKET')
  const endpoint = env('TOS_ENDPOINT').replace(/^https?:\/\//, '').replace(/\/+$/g, '')
  const keyPrefix = trimSlashes(env('TOS_KEY_PREFIX'))
  if (!endpoint) return ''

  const isCustomDomain = env('TOS_IS_CUSTOM_DOMAIN').toLowerCase() === 'true'
  const host = isCustomDomain ? endpoint : `${bucket}.${endpoint}`
  const baseUrl = `https://${host}`

  return keyPrefix ? joinUrl(baseUrl, keyPrefix) : baseUrl
}

function parseGitHubRepository() {
  const repository = env('GITHUB_REPOSITORY')
  if (repository) {
    const [owner, repo] = repository.split('/')
    if (owner && repo) return { owner, repo }
  }

  throw new Error('GITHUB_REPOSITORY is required')
}

function resolveReleaseTag() {
  const tag = process.argv.find((arg) => arg.startsWith('--tag='))?.slice('--tag='.length)
    || env('GITHUB_REF_NAME')

  if (!tag) {
    throw new Error('Release tag is required')
  }

  return tag
}

async function github(path, options = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${requiredEnv('GITHUB_TOKEN')}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {})
    }
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${body}`)
  }

  if (response.status === 204) return null
  return response.json()
}

async function githubBuffer(url) {
  return retry('GitHub asset download', async () => {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/octet-stream',
        Authorization: `Bearer ${requiredEnv('GITHUB_TOKEN')}`,
        'X-GitHub-Api-Version': '2022-11-28'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(downloadTimeoutMs)
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Download release asset failed: ${response.status} ${body}`)
    }

    return Buffer.from(await response.arrayBuffer())
  })
}

function contentTypeFor(name) {
  if (name.endsWith('.json')) return 'application/json'
  if (name.endsWith('.sig')) return 'text/plain; charset=utf-8'
  if (name.endsWith('.gz')) return 'application/gzip'
  if (name.endsWith('.dmg')) return 'application/x-apple-diskimage'
  if (name.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable'
  if (name.endsWith('.msi')) return 'application/x-msi'
  return 'application/octet-stream'
}

function cacheControlFor(name) {
  return name === 'latest.json'
    ? 'no-cache, no-store, must-revalidate'
    : 'public, max-age=31536000, immutable'
}

function platformForAsset(name) {
  if (name.endsWith('.app.tar.gz')) {
    return name.includes('x64') || name.includes('x86_64') ? 'darwin-x86_64' : 'darwin-aarch64'
  }

  if (name.endsWith('-setup.exe')) {
    return name.includes('arm64') || name.includes('aarch64') ? 'windows-aarch64' : 'windows-x86_64'
  }

  return ''
}

function isUpdaterAsset(name) {
  const unsignedName = name.endsWith('.sig') ? name.slice(0, -'.sig'.length) : name
  return Boolean(platformForAsset(unsignedName))
}

function buildLatestJson({ release, tag, assetBuffers, cdnUrls }) {
  const version = tag.replace(/^v/, '')
  const platforms = {}

  for (const [name, buffer] of assetBuffers.entries()) {
    const platform = platformForAsset(name)
    if (!platform) continue

    const sig = assetBuffers.get(`${name}.sig`)
    if (!sig) {
      throw new Error(`Missing updater signature asset: ${name}.sig`)
    }

    const platformInfo = {
      signature: sig.toString('utf8').trim(),
      url: cdnUrls.get(name)
    }
    platforms[platform] = platformInfo

    if (platform.startsWith('darwin-')) {
      platforms[`${platform}-app`] = platformInfo
    }
  }

  const requiredPlatforms = ['darwin-aarch64', 'windows-x86_64']
  const missingPlatforms = requiredPlatforms.filter(platform => !platforms[platform])
  if (missingPlatforms.length > 0) {
    throw new Error(`Missing updater platform assets: ${missingPlatforms.join(', ')}`)
  }

  return {
    version,
    notes: release.body || `Automated desktop release for ${tag}.`,
    pub_date: release.published_at || new Date().toISOString(),
    platforms
  }
}

async function uploadObject(client, key, body, name) {
  const startedAt = Date.now()
  const size = body.length
  console.log(`uploading ${key} (${formatBytes(size)})`)

  await retry(`TOS upload ${name}`, async (attempt) => {
    if (attempt > 1) {
      console.log(`retrying ${key} (attempt ${attempt}/${maxTransferAttempts})`)
    }

    const input = {
      key,
      contentType: contentTypeFor(name),
      cacheControl: cacheControlFor(name)
    }

    if (size < multipartThreshold) {
      await client.putObject({ ...input, body })
      return
    }

    let lastLoggedPercent = 0
    await client.uploadFile({
      ...input,
      file: body,
      partSize: multipartPartSize,
      taskNum: 4,
      progress(percent) {
        const completedPercent = Math.floor(percent * 100)
        if (completedPercent >= lastLoggedPercent + 25 || completedPercent === 100) {
          lastLoggedPercent = completedPercent
          console.log(`upload progress ${name}: ${completedPercent}%`)
        }
      }
    })
  })

  console.log(`uploaded ${key} in ${formatDuration(startedAt)}`)
}

loadEnvFile(envPath)

const repo = parseGitHubRepository()
const tag = resolveReleaseTag()
const release = await github(`/repos/${repo.owner}/${repo.repo}/releases/tags/${encodeURIComponent(tag)}`)
const assets = await github(`/repos/${repo.owner}/${repo.repo}/releases/${release.id}/assets?per_page=100`)
const publicBaseUrl = env('DESKTOP_UPDATER_BASE_URL') || buildTosPublicBaseUrl()
if (!publicBaseUrl) {
  throw new Error('DESKTOP_UPDATER_BASE_URL or TOS public URL configuration is required')
}
const manifestPath = env('DESKTOP_UPDATER_MANIFEST_PATH') || 'desktop-updater/latest.json'
const manifestDir = dirname(manifestPath) === '.' ? '' : dirname(manifestPath)
const keyPrefix = trimSlashes(env('TOS_KEY_PREFIX'))
const assetBuffers = new Map()
const cdnUrls = new Map()

const client = new TosClient({
  accessKeyId: requiredEnv('TOS_ACCESS_KEY'),
  accessKeySecret: requiredEnv('TOS_SECRET_KEY'),
  stsToken: env('TOS_SECURITY_TOKEN') || undefined,
  region: requiredEnv('TOS_REGION'),
  endpoint: requiredEnv('TOS_ENDPOINT'),
  bucket: requiredEnv('TOS_BUCKET'),
  isCustomDomain: env('TOS_IS_CUSTOM_DOMAIN').toLowerCase() === 'true',
  connectionTimeout: 10_000,
  requestTimeout: 120_000,
  maxRetryCount: 0
})

const updaterAssets = assets
  .filter(asset => isUpdaterAsset(asset.name))
  .sort((left, right) => Number(left.name.endsWith('.sig')) - Number(right.name.endsWith('.sig')))

console.log(`selected ${updaterAssets.length}/${assets.length} release assets for updater publishing`)

await mapWithConcurrency(updaterAssets, transferConcurrency, async (asset) => {
  const downloadStartedAt = Date.now()
  console.log(`downloading ${asset.name} (${formatBytes(asset.size)})`)
  const buffer = await githubBuffer(asset.url)
  console.log(`downloaded ${asset.name} in ${formatDuration(downloadStartedAt)}`)
  const objectPath = joinPath(keyPrefix, manifestDir, asset.name)
  assetBuffers.set(asset.name, buffer)
  cdnUrls.set(asset.name, joinUrl(publicBaseUrl, joinPath(manifestDir, asset.name)))
  await uploadObject(client, objectPath, buffer, asset.name)
})

const latestJson = buildLatestJson({ release, tag, assetBuffers, cdnUrls })
const latestBody = Buffer.from(`${JSON.stringify(latestJson, null, 2)}\n`)
await uploadObject(client, joinPath(keyPrefix, manifestPath), latestBody, 'latest.json')

console.log(`Desktop updater CDN manifest: ${joinUrl(publicBaseUrl, manifestPath)}`)
