import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const envPath = resolve(root, '.env')
const outputPath = resolve(root, process.env.DESKTOP_UPDATER_CONFIG_PATH || '.output/tauri.updater.json')
const defaultEndpoint = 'https://playlet-ai.tos-cn-guangzhou.volces.com/manju-assets/desktop-updater/latest.json'

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

function trimSlashes(value) {
  return value.replace(/^\/+|\/+$/g, '')
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/g, '')
}

function joinUrl(baseUrl, path) {
  return `${normalizeBaseUrl(baseUrl)}/${trimSlashes(path)}`
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

function resolveUpdaterEndpoint() {
  const explicitEndpoint = env('DESKTOP_UPDATER_ENDPOINT') || env('TAURI_UPDATER_ENDPOINT')
  if (explicitEndpoint) return explicitEndpoint

  const baseUrl = env('DESKTOP_UPDATER_BASE_URL') || buildTosPublicBaseUrl()
  if (baseUrl) {
    return joinUrl(baseUrl, env('DESKTOP_UPDATER_MANIFEST_PATH') || 'desktop-updater/latest.json')
  }

  return defaultEndpoint
}

loadEnvFile(envPath)

const endpoint = resolveUpdaterEndpoint()
const config = {
  plugins: {
    updater: {
      endpoints: [endpoint]
    }
  }
}

mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`)
console.log(`Desktop updater endpoint: ${endpoint}`)
console.log(`Wrote Tauri updater config: ${outputPath}`)
