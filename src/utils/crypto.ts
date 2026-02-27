/**
 * 纯加密工具函数
 *
 * 基于 Node.js 原生 crypto 模块，不涉及任何 I/O 操作
 */

import crypto from 'node:crypto'

/** P-256 SPKI DER 前缀 (26 bytes) */
export const SPKI_PREFIX = Buffer.from(
  '3059301306072a8648ce3d020106082a8648ce3d030107034200',
  'hex'
)

/**
 * ChaCha20 加密/解密（对称，流密码）
 *
 * @param key 32 字节密钥
 * @param nonce 12 字节 nonce（会自动补齐为 16 字节 IV）
 * @param data 待加密/解密数据
 */
export function chacha20Crypt(key: Buffer, nonce: Buffer, data: Buffer): Buffer {
  let iv: Buffer
  if (nonce.length === 12) {
    iv = Buffer.alloc(16)
    nonce.copy(iv, 4) // 4 字节计数器(0) + 12 字节 nonce
  } else {
    iv = nonce
  }
  const cipher = crypto.createCipheriv('chacha20', key, iv)
  return Buffer.concat([cipher.update(data), cipher.final()])
}

/**
 * HKDF 密钥派生
 *
 * @param sharedKey 输入密钥材料 (IKM)
 * @param salt 盐值
 * @param info 上下文信息
 * @param length 派生密钥长度（字节，默认 32）
 */
export function deriveKey(sharedKey: Buffer, salt: Buffer, info: Buffer, length = 32): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', sharedKey, salt, info, length))
}

/**
 * 生成 ECDH P-256 密钥对
 *
 * @returns { privateKey, publicKey, uncompressedPoint }
 */
export function generateEcKeyPair() {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'prime256v1'
  })
  // 获取未压缩点格式 (65 bytes: 0x04 + X + Y)
  const spkiDer = publicKey.export({ type: 'spki', format: 'der' })
  const uncompressedPoint = spkiDer.subarray(SPKI_PREFIX.length)

  return { privateKey, publicKey, uncompressedPoint }
}

/**
 * 从未压缩点格式重建 EC 公钥
 *
 * @param uncompressedPoint 65 字节的未压缩点格式
 */
export function publicKeyFromUncompressedPoint(uncompressedPoint: Buffer): crypto.KeyObject {
  const spkiDer = Buffer.concat([SPKI_PREFIX, uncompressedPoint])
  return crypto.createPublicKey({ key: spkiDer, type: 'spki', format: 'der' })
}

/**
 * ECDH 密钥协商
 */
export function ecdhDeriveSharedKey(
  privateKey: crypto.KeyObject,
  publicKey: crypto.KeyObject
): Buffer {
  return crypto.diffieHellman({ publicKey, privateKey })
}

/**
 * ECDSA 签名
 */
export function ecdsaSign(data: Buffer, privateKey: crypto.KeyObject): Buffer {
  return crypto.sign('sha256', data, privateKey)
}

/**
 * MD5 哈希（大写十六进制）
 */
export function md5Hex(data: string | Buffer): string {
  return crypto.createHash('md5').update(data).digest('hex').toUpperCase()
}

/**
 * 生成随机字节
 */
export function randomBytes(size: number): Buffer {
  return crypto.randomBytes(size)
}

/**
 * 生成随机 UUID
 */
export function randomUUID(): string {
  return crypto.randomUUID()
}

/**
 * 生成随机十六进制字符串
 */
export function randomHex(byteSize: number): string {
  return crypto.randomBytes(byteSize).toString('hex')
}
