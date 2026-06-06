import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

const distDir = resolve(process.cwd(), '.output/public')
const indexFile = resolve(distDir, 'index.html')

function fail(message) {
  console.error(message)
  process.exit(1)
}

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  fail(`Desktop frontend assets not found: ${distDir}`)
}

if (!existsSync(indexFile) || !statSync(indexFile).isFile()) {
  fail(`Desktop frontend entry not found: ${indexFile}`)
}

if (readdirSync(distDir).length === 0) {
  fail(`Desktop frontend assets directory is empty: ${distDir}`)
}

console.log(`Using prebuilt desktop frontend assets: ${distDir}`)
