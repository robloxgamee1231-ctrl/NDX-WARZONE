import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt)
const parameters = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }
const dummy = '00000000000000000000000000000000.' + '00'.repeat(64)
let pending = 0

export class AccountError extends Error {
  constructor(status, message) {
    super(message)
    this.status = status
  }
}
export const token = () => randomBytes(32).toString('base64url')
export const digest = (value) =>
  createHash('sha256').update(value).digest('hex')
export const usernameOK = (value) =>
  typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{2,15}$/.test(value)
export const validSecret = (value) =>
  typeof value === 'string' && Buffer.byteLength(value) <= 128
export function requirePassword(value, username) {
  if (
    !validSecret(value) ||
    [...value.trim()].length < 12 ||
    value.toLowerCase() === username.toLowerCase()
  ) {
    throw new AccountError(
      400,
      'Use a password of at least 12 characters, different from your username.',
    )
  }
}
async function hash(value, salt) {
  if (pending >= 4)
    throw new AccountError(429, 'Sign-in is busy. Try again in a moment.')
  pending++
  try {
    return await derive(value, salt, 64, parameters)
  } finally {
    pending--
  }
}
export async function encodePassword(value) {
  const salt = randomBytes(16).toString('hex')
  const key = await hash(value, salt)
  return `${salt}.${key.toString('hex')}`
}
export async function verifyPassword(value, encoded) {
  if (!validSecret(value)) return false
  const [salt, key] = (encoded ?? dummy).split('.')
  return (
    timingSafeEqual(await hash(value, salt), Buffer.from(key, 'hex')) &&
    !!encoded
  )
}
export function verifyRecovery(value, hash) {
  return (
    typeof value === 'string' &&
    /^[A-Za-z0-9_-]{43}$/.test(value) &&
    !!hash &&
    timingSafeEqual(Buffer.from(digest(value), 'hex'), Buffer.from(hash, 'hex'))
  )
}
