import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function readJsonVersion(relativePath) {
  const content = readFileSync(resolve(root, relativePath), 'utf8')
  const version = JSON.parse(content).version

  if (typeof version !== 'string' || !version.trim()) {
    throw new Error(`${relativePath} does not contain a valid version`)
  }

  return version.trim()
}

function readCargoPackageVersion() {
  const relativePath = 'src-tauri/Cargo.toml'
  const content = readFileSync(resolve(root, relativePath), 'utf8')
  const packageSection = content.match(/\[package\]([\s\S]*?)(?:\n\[|$)/)?.[1]
  const version = packageSection?.match(/^version\s*=\s*"([^"]+)"\s*$/m)?.[1]

  if (!version) {
    throw new Error(`${relativePath} does not contain a valid [package] version`)
  }

  return version
}

function readCargoLockVersion() {
  const relativePath = 'src-tauri/Cargo.lock'
  const content = readFileSync(resolve(root, relativePath), 'utf8')
  const version = content.match(
    /\[\[package\]\]\nname = "playlet-desktop"\nversion = "([^"]+)"/
  )?.[1]

  if (!version) {
    throw new Error(`${relativePath} does not contain the playlet-desktop package version`)
  }

  return version
}

const versions = {
  'package.json': readJsonVersion('package.json'),
  'src-tauri/tauri.conf.json': readJsonVersion('src-tauri/tauri.conf.json'),
  'src-tauri/Cargo.toml': readCargoPackageVersion(),
  'src-tauri/Cargo.lock': readCargoLockVersion()
}
const expectedVersion = versions['package.json']
const mismatches = Object.entries(versions).filter(([, version]) => version !== expectedVersion)

if (mismatches.length > 0) {
  const details = Object.entries(versions)
    .map(([path, version]) => `  ${path}: ${version}`)
    .join('\n')
  throw new Error(`Desktop version mismatch:\n${details}`)
}

console.log(`Desktop versions are synchronized at ${expectedVersion}`)
