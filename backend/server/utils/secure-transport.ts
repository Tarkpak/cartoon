import { createCipheriv, createHash, createPublicKey, diffieHellman, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto'
import { createError, getRequestHeader, type H3Event } from 'h3'

const SECURE_REQUEST_HEADER = 'x-playlet-secure-request'
const SECURE_TRANSPORT_ALGORITHM = 'x25519-aes-256-gcm'
const SECURE_TRANSPORT_VERSION = 1
const X25519_SPKI_PREFIX = Buffer.from('302a300506032b656e032100', 'hex')
const TRANSPORT_CONTEXT = Buffer.from('playlet.cloud-secret-transport.v1', 'utf8')
const TRANSPORT_AAD = Buffer.from('playlet.cloud-secret-response.v1', 'utf8')

function decodeClientPublicKey(header: string) {
  const [version, publicKeyText] = header.trim().split(':', 2)
  if (version !== 'v1' || !publicKeyText) {
    throw createError({ statusCode: 400, statusMessage: '加密通道协商失败' })
  }

  const publicKey = Buffer.from(publicKeyText, 'base64')
  if (publicKey.length !== 32) {
    throw createError({ statusCode: 400, statusMessage: '加密通道协商失败' })
  }
  return publicKey
}

function x25519PublicKeyFromRaw(raw: Buffer) {
  return createPublicKey({
    key: Buffer.concat([X25519_SPKI_PREFIX, raw]),
    format: 'der',
    type: 'spki'
  })
}

function x25519RawPublicKey(publicKey: KeyObject) {
  return Buffer.from(publicKey.export({ format: 'der', type: 'spki' })).subarray(-32)
}

function transportKey(sharedSecret: Buffer, clientPublicKey: Buffer, serverPublicKey: Buffer) {
  return createHash('sha256')
    .update(TRANSPORT_CONTEXT)
    .update(sharedSecret)
    .update(clientPublicKey)
    .update(serverPublicKey)
    .digest()
}

export function encryptedClientResponse(event: H3Event, data: unknown) {
  const header = getRequestHeader(event, SECURE_REQUEST_HEADER)
  if (!header) {
    throw createError({ statusCode: 426, statusMessage: '客户端版本过旧，请升级后重新登录' })
  }

  try {
    const clientPublicKey = decodeClientPublicKey(header)
    const serverKeys = generateKeyPairSync('x25519')
    const serverPublicKey = x25519RawPublicKey(serverKeys.publicKey)
    const sharedSecret = diffieHellman({
      privateKey: serverKeys.privateKey,
      publicKey: x25519PublicKeyFromRaw(clientPublicKey)
    })
    const key = transportKey(sharedSecret, clientPublicKey, serverPublicKey)
    const nonce = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', key, nonce)
    cipher.setAAD(TRANSPORT_AAD)
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(data), 'utf8'),
      cipher.final(),
      cipher.getAuthTag()
    ])

    return {
      success: true,
      data: {
        encrypted: true,
        version: SECURE_TRANSPORT_VERSION,
        algorithm: SECURE_TRANSPORT_ALGORITHM,
        serverPublicKey: serverPublicKey.toString('base64'),
        nonce: nonce.toString('base64'),
        payload: ciphertext.toString('base64')
      }
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'statusCode' in error) throw error
    throw createError({ statusCode: 400, statusMessage: '加密通道协商失败' })
  }
}
