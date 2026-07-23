import { copyTosObject, listTosFiles } from '../server/utils/tos-files'
import { tosStorageClientConfig } from '../server/utils/tos-storage'

const DAYS = 7
const ADMIN_ACCOUNT = 'admin'
const execute = process.argv.includes('--execute')
const cutoff = Date.now() - DAYS * 24 * 60 * 60 * 1000

function joinKey(...parts: string[]) {
  return parts
    .map(part => part.trim().replace(/^\/+|\/+$/g, ''))
    .filter(Boolean)
    .join('/')
}

async function listRecentRootAssets(category: 'images' | 'videos') {
  const config = tosStorageClientConfig()
  const sourcePrefix = joinKey(config.keyPrefix, category)
  const files: Array<{ key: string, size: number, lastModified: string }> = []
  let continuationToken: string | undefined

  do {
    const page = await listTosFiles({
      prefix: sourcePrefix,
      prefixProvided: true,
      delimiter: '',
      maxKeys: 1000,
      continuationToken
    })
    files.push(...page.files
      .filter(file => new Date(file.lastModified).getTime() >= cutoff)
      .map(file => ({ key: file.key, size: file.size, lastModified: file.lastModified })))
    continuationToken = page.isTruncated ? page.nextContinuationToken : undefined
  } while (continuationToken)

  return files.map(file => ({
    ...file,
    targetKey: joinKey(
      config.keyPrefix,
      'users',
      ADMIN_ACCOUNT,
      file.key.slice(joinKey(config.keyPrefix).length).replace(/^\/+/, '')
    )
  }))
}

const assets = [
  ...await listRecentRootAssets('images'),
  ...await listRecentRootAssets('videos')
].sort((a, b) => a.lastModified.localeCompare(b.lastModified))

const totalBytes = assets.reduce((total, asset) => total + asset.size, 0)
console.log(JSON.stringify({
  mode: execute ? 'execute' : 'preview',
  days: DAYS,
  cutoff: new Date(cutoff).toISOString(),
  count: assets.length,
  totalBytes,
  first: assets.at(0)?.lastModified || null,
  last: assets.at(-1)?.lastModified || null
}, null, 2))

if (!execute) process.exit(0)

let copied = 0
let skipped = 0
const failures: Array<{ key: string, message: string }> = []
for (const asset of assets) {
  try {
    const result = await copyTosObject(asset.key, asset.targetKey)
    if (result.copied) copied += 1
    else skipped += 1
  } catch (error) {
    failures.push({
      key: asset.key,
      message: error instanceof Error ? error.message : String(error)
    })
  }
}

console.log(JSON.stringify({ copied, skipped, failed: failures.length, failures }, null, 2))
if (failures.length > 0) process.exitCode = 1
