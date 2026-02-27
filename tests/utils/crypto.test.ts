import { describe, expect, test } from 'vitest'
import {
  chacha20Crypt,
  deriveKey,
  generateEcKeyPair,
  publicKeyFromUncompressedPoint,
  ecdhDeriveSharedKey,
  ecdsaSign,
  md5Hex,
  randomBytes,
  randomUUID,
  randomHex,
  SPKI_PREFIX
} from '../../src/utils/crypto.js'

describe('crypto utils', () => {
  test('md5Hex returns uppercase hex', () => {
    const hash = md5Hex('hello')
    expect(hash).toMatch(/^[0-9A-F]{32}$/)
    expect(hash).toBe('5D41402ABC4B2A76B9719D911017C592')
  })

  test('md5Hex with Buffer input', () => {
    const hash = md5Hex(Buffer.from('hello'))
    expect(hash).toBe('5D41402ABC4B2A76B9719D911017C592')
  })

  test('randomBytes returns correct length', () => {
    const bytes = randomBytes(32)
    expect(bytes.length).toBe(32)
    expect(Buffer.isBuffer(bytes)).toBe(true)
  })

  test('randomUUID returns valid UUID format', () => {
    const uuid = randomUUID()
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  test('randomHex returns correct length', () => {
    const hex = randomHex(8)
    expect(hex.length).toBe(16) // 8 bytes = 16 hex chars
    expect(hex).toMatch(/^[0-9a-f]+$/)
  })

  test('chacha20Crypt: encrypt then decrypt', () => {
    const key = randomBytes(32)
    const nonce = randomBytes(12)
    const plaintext = Buffer.from('Hello, World!')

    const ciphertext = chacha20Crypt(key, nonce, plaintext)
    expect(ciphertext.length).toBe(plaintext.length)
    expect(ciphertext).not.toEqual(plaintext)

    const decrypted = chacha20Crypt(key, nonce, ciphertext)
    expect(decrypted).toEqual(plaintext)
  })

  test('deriveKey returns 32 bytes by default', () => {
    const ikm = randomBytes(32)
    const salt = randomBytes(32)
    const info = Buffer.from('test-info')

    const derived = deriveKey(ikm, salt, info)
    expect(derived.length).toBe(32)
    expect(Buffer.isBuffer(derived)).toBe(true)
  })

  test('deriveKey is deterministic', () => {
    const ikm = Buffer.alloc(32, 0x42)
    const salt = Buffer.alloc(32, 0x01)
    const info = Buffer.from('test')

    const key1 = deriveKey(ikm, salt, info)
    const key2 = deriveKey(ikm, salt, info)
    expect(key1).toEqual(key2)
  })

  test('generateEcKeyPair returns valid key pair', () => {
    const { privateKey, publicKey, uncompressedPoint } = generateEcKeyPair()

    expect(privateKey).toBeDefined()
    expect(publicKey).toBeDefined()
    expect(uncompressedPoint.length).toBe(65) // 1 + 32 + 32
    expect(uncompressedPoint[0]).toBe(0x04) // uncompressed point prefix
  })

  test('publicKeyFromUncompressedPoint reconstructs key', () => {
    const { uncompressedPoint } = generateEcKeyPair()
    const key = publicKeyFromUncompressedPoint(uncompressedPoint)
    expect(key).toBeDefined()
    expect(key.type).toBe('public')
  })

  test('ecdhDeriveSharedKey produces consistent shared secret', () => {
    const alice = generateEcKeyPair()
    const bob = generateEcKeyPair()

    const sharedA = ecdhDeriveSharedKey(alice.privateKey, bob.publicKey)
    const sharedB = ecdhDeriveSharedKey(bob.privateKey, alice.publicKey)

    expect(sharedA).toEqual(sharedB)
    expect(sharedA.length).toBe(32) // P-256 shared secret
  })

  test('ecdsaSign produces valid signature', () => {
    const { privateKey } = generateEcKeyPair()
    const data = Buffer.from('test data to sign')

    const signature = ecdsaSign(data, privateKey)
    expect(signature.length).toBeGreaterThan(0)
    expect(Buffer.isBuffer(signature)).toBe(true)
  })

  test('SPKI_PREFIX is 26 bytes', () => {
    expect(SPKI_PREFIX.length).toBe(26)
  })
})
