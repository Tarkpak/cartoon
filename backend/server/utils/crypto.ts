import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from 'node:crypto'
import { dataDir } from './db'

const PASSWORD_PREFIX = 'scrypt'
const ENCRYPTION_VERSION = 'v1'

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('base64url')
  const hash = scryptSync(password, salt, 64).toString('base64url')
  return `${PASSWORD_PREFIX}:${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string) {
  const [scheme, salt, expected] = stored.split(':')
  if (scheme !== PASSWORD_PREFIX || !salt || !expected) return false
  const actual = Buffer.from(scryptSync(password, salt, 64).toString('base64url'))
  const expectedBuffer = Buffer.from(expected)
  if (actual.length !== expectedBuffer.length) return false
  return timingSafeEqual(actual, expectedBuffer)
}

export function randomToken() {
  return randomBytes(32).toString('base64url')
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

function secretPath() {
  return resolve(dataDir(), 'app-secret.key')
}

function appSecret() {
  const envSecret = process.env.PLAYLET_ADMIN_ENCRYPTION_SECRET
  if (envSecret && envSecret.trim().length >= 16) return envSecret.trim()

  const target = secretPath()
  if (existsSync(target)) return readFileSync(target, 'utf8').trim()

  const dir = dirname(target)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const generated = randomBytes(32).toString('base64url')
  writeFileSync(target, generated, { encoding: 'utf8', mode: 0o600 })
  return generated
}

function encryptionKey() {
  return createHash('sha256').update(appSecret()).digest()
}

export function encryptText(value: string | null | undefined) {
  const text = value?.trim() || ''
  if (!text) return ''
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return [
    ENCRYPTION_VERSION,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ciphertext.toString('base64url')
  ].join(':')
}

export function decryptText(value: string | null | undefined) {
  if (!value) return ''
  const [version, ivText, tagText, ciphertextText] = value.split(':')
  if (version !== ENCRYPTION_VERSION || !ivText || !tagText || !ciphertextText) return ''
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivText, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagText, 'base64url'))
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, 'base64url')),
    decipher.final()
  ])
  return plaintext.toString('utf8')
}

