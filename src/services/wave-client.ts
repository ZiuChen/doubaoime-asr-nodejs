/**
 * ByteDance Wave 加密协议客户端
 *
 * 使用 ECDH 密钥交换 + ChaCha20 加密 + HKDF 密钥派生
 * 完全基于 Node.js 原生 crypto 模块实现
 */

import { HANDSHAKE_URL, HKDF_INFO, USER_AGENT } from '../constants.js'
import {
  chacha20Crypt,
  deriveKey,
  ecdhDeriveSharedKey,
  ecdsaSign,
  generateEcKeyPair,
  md5Hex,
  publicKeyFromUncompressedPoint,
  randomBytes
} from '../utils/crypto.js'

// ─── Wave Session ──────────────────────────────────────────────

export interface WaveSession {
  ticket: string
  ticketLong: string
  encryptionKey: Buffer
  clientRandom: Buffer
  serverRandom: Buffer
  sharedKey: Buffer
  ticketExp: number
  ticketLongExp: number
  expiresAt: number
}

export function isSessionExpired(session: WaveSession): boolean {
  return Date.now() / 1000 >= session.expiresAt
}

/** 序列化为可 JSON 存储的对象 */
export function serializeSession(session: WaveSession): Record<string, unknown> {
  return {
    ticket: session.ticket,
    ticketLong: session.ticketLong,
    encryptionKey: session.encryptionKey.toString('base64'),
    clientRandom: session.clientRandom.toString('base64'),
    serverRandom: session.serverRandom.toString('base64'),
    sharedKey: session.sharedKey.toString('base64'),
    ticketExp: session.ticketExp,
    ticketLongExp: session.ticketLongExp,
    expiresAt: session.expiresAt
  }
}

/** 从 JSON 对象反序列化 */
export function deserializeSession(data: Record<string, unknown>): WaveSession {
  return {
    ticket: data.ticket as string,
    ticketLong: data.ticketLong as string,
    encryptionKey: Buffer.from(data.encryptionKey as string, 'base64'),
    clientRandom: Buffer.from(data.clientRandom as string, 'base64'),
    serverRandom: Buffer.from(data.serverRandom as string, 'base64'),
    sharedKey: Buffer.from(data.sharedKey as string, 'base64'),
    ticketExp: data.ticketExp as number,
    ticketLongExp: data.ticketLongExp as number,
    expiresAt: data.expiresAt as number
  }
}

// ─── Wave Client ──────────────────────────────────────────────

export class WaveClient {
  deviceId: string
  appId: string
  session: WaveSession | null
  private onSessionUpdate?: (session: WaveSession) => void

  constructor(
    deviceId: string,
    appId: string | number,
    session?: WaveSession | null,
    onSessionUpdate?: (session: WaveSession) => void
  ) {
    this.deviceId = deviceId
    this.appId = String(appId)
    this.session = session ?? null
    this.onSessionUpdate = onSessionUpdate
  }

  /**
   * 执行 Wave 握手，建立加密会话
   */
  async handshake(): Promise<boolean> {
    const { privateKey, uncompressedPoint } = generateEcKeyPair()

    const clientRandom = randomBytes(32)

    // 构建握手请求
    const request = {
      version: 2,
      random: clientRandom.toString('base64'),
      app_id: this.appId,
      did: this.deviceId,
      key_shares: [
        {
          curve: 'secp256r1',
          pubkey: uncompressedPoint.toString('base64')
        }
      ],
      cipher_suites: [4097] // ChaCha20
    }

    const requestJson = JSON.stringify(request)

    // ECDSA 签名
    const signature = ecdsaSign(Buffer.from(requestJson), privateKey)

    const headers = {
      'Content-Type': 'application/json',
      'x-tt-s-sign': signature.toString('base64'),
      'User-Agent': USER_AGENT
    }

    const response = await fetch(HANDSHAKE_URL, {
      method: 'POST',
      headers,
      body: requestJson
    })

    if (!response.ok) return false

    const resp = (await response.json()) as {
      version: number
      random: string
      key_share: { curve: string; pubkey: string }
      cipher_suite: number
      cert: string
      ticket: string
      ticket_exp: number
      ticket_long: string
      ticket_long_exp: number
    }

    // 计算共享密钥
    const serverPubKeyRaw = Buffer.from(resp.key_share.pubkey, 'base64')
    const serverPublicKey = publicKeyFromUncompressedPoint(serverPubKeyRaw)

    // ECDH 密钥协商
    const sharedKey = ecdhDeriveSharedKey(privateKey, serverPublicKey)

    const serverRandom = Buffer.from(resp.random, 'base64')

    // HKDF 派生加密密钥
    const salt = Buffer.concat([clientRandom, serverRandom])
    const encryptionKey = deriveKey(sharedKey, salt, HKDF_INFO)

    // 保存会话（提前 60 秒视为过期）
    this.session = {
      ticket: resp.ticket,
      ticketLong: resp.ticket_long,
      encryptionKey,
      clientRandom,
      serverRandom,
      sharedKey,
      ticketExp: resp.ticket_exp,
      ticketLongExp: resp.ticket_long_exp,
      expiresAt: Date.now() / 1000 + resp.ticket_exp - 60
    }

    this.onSessionUpdate?.(this.session)
    return true
  }

  /**
   * 确保会话有效，如果过期则自动刷新
   */
  private async ensureSession(): Promise<void> {
    if (!this.session || isSessionExpired(this.session)) {
      const ok = await this.handshake()
      if (!ok) throw new Error('Failed to establish/refresh Wave session')
    }
  }

  /**
   * 准备加密请求
   */
  async prepareRequest(
    plaintext: Buffer,
    extraHeaders?: Record<string, string>
  ): Promise<[Buffer, Record<string, string>]> {
    await this.ensureSession()

    const nonce = randomBytes(12)
    const ciphertext = chacha20Crypt(this.session!.encryptionKey, nonce, plaintext)
    const stub = md5Hex(ciphertext)

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-tt-e-b': '1',
      'x-tt-e-t': this.session!.ticket,
      'x-tt-e-p': nonce.toString('base64'),
      'x-ss-stub': stub
    }

    if (extraHeaders) {
      Object.assign(headers, extraHeaders)
    }

    return [ciphertext, headers]
  }

  /**
   * 解密数据
   */
  decrypt(ciphertext: Buffer, nonce: Buffer): Buffer {
    if (!this.session) throw new Error('No active session. Call handshake() first.')
    return chacha20Crypt(this.session.encryptionKey, nonce, ciphertext)
  }
}
