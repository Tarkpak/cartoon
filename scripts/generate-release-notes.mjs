#!/usr/bin/env node
import { execSync } from 'node:child_process'

const releaseRef = process.argv[2] || process.env.GITHUB_REF_NAME || 'HEAD'

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

function getOutput(command) {
  return execSync(command, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore']
  }).trim()
}

function tryGetOutput(command) {
  try {
    return getOutput(command)
  } catch {
    return ''
  }
}

function refExists(ref) {
  return tryGetOutput(`git rev-parse --verify ${shellQuote(`${ref}^{commit}`)}`) !== ''
}

function isReleaseCommit(subject) {
  return /^chore(?:\([^)]+\))?: release v?\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/i.test(subject.trim())
}

function getCurrentRef(ref) {
  return refExists(ref) ? ref : 'HEAD'
}

function getPreviousTag(currentRef) {
  return tryGetOutput(`git describe --tags --abbrev=0 ${shellQuote(`${currentRef}^`)}`)
}

function getCommitSubjects(range) {
  const raw = tryGetOutput(`git log --no-merges --format=%s ${range}`)
  if (!raw) return []

  const subjects = []
  const seen = new Set()

  for (const line of raw.split('\n')) {
    const subject = line.trim()
    if (!subject || isReleaseCommit(subject) || seen.has(subject)) continue
    seen.add(subject)
    subjects.push(subject)
  }

  return subjects
}

function buildReleaseNotes() {
  const currentRef = getCurrentRef(releaseRef)
  const previousTag = getPreviousTag(currentRef)
  const range = previousTag
    ? `${shellQuote(previousTag)}..${shellQuote(currentRef)}`
    : shellQuote(currentRef)
  const subjects = getCommitSubjects(range)
  const title = releaseRef && releaseRef !== 'HEAD' ? releaseRef : '当前版本'

  const lines = [
    `版本：${title}`,
    previousTag ? `范围：${previousTag} -> ${title}` : '',
    '',
    '更新内容'
  ].filter(line => line !== '')

  if (subjects.length === 0) {
    lines.push('- 本次发布主要包含版本同步与构建更新。')
  } else {
    lines.push(...subjects.map(subject => `- ${subject}`))
  }

  return `${lines.join('\n')}\n`
}

process.stdout.write(buildReleaseNotes())
