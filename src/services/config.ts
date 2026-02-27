/**
 * ASR 配置
 *
 * 管理设备凭据、Token、会话配置等
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'

import { AID, USER_AGENT, WEBSOCKET_URL } from '../constants.js'
import { isJwtExpired } from '../utils/jwt.js'
import { registerDevice, getAsrToken } from './device.js'
import { getSamiToken } from './sami.js'
import {
  WaveClient,
  deserializeSession,
  isSessionExpired,
  serializeSession,
  type WaveSession
} from './wave-client.js'
import type { DeviceCredentials, OpusEncoder, SessionConfig } from '../types.js'

export interface ASRConfigOptions {
  /** WebSocket URL */
  url?: string
  /** 应用 ID */
  aid?: number
  /** User-Agent */
  userAgent?: string
  /** 设备 ID（空则自动获取） */
  deviceId?: string
  /** ASR Token（空则自动获取） */
  token?: string
  /**
   * 凭据对象（直接传入，优先级高于 credentialPath）
   *
   * 作为库使用时，可直接传入已有的 DeviceCredentials 对象，
   * 无需依赖文件系统。
   */
  credentials?: DeviceCredentials
  /** 凭据文件路径 */
  credentialPath?: string
  /** Opus 编码器实例 */
  opusEncoder?: OpusEncoder
  /** 采样率 */
  sampleRate?: number
  /** 声道数 */
  channels?: number
  /** 帧时长（毫秒） */
  frameDurationMs?: number
  /** 是否启用标点 */
  enablePunctuation?: boolean
  /** 是否启用语音拒绝 */
  enableSpeechRejection?: boolean
  /** 是否启用两遍识别 */
  enableAsrTwopass?: boolean
  /** 是否启用三遍识别 */
  enableAsrThreepass?: boolean
  /** 当前所在应用名 */
  appName?: string
  /** 连接超时（毫秒） */
  connectTimeout?: number
  /** 接收超时（毫秒） */
  recvTimeout?: number
}

export class ASRConfig {
  url: string
  aid: number
  userAgent: string
  deviceId?: string
  token?: string
  credentialPath?: string
  opusEncoder?: OpusEncoder

  sampleRate: number
  channels: number
  frameDurationMs: number

  enablePunctuation: boolean
  enableSpeechRejection: boolean
  enableAsrTwopass: boolean
  enableAsrThreepass: boolean
  appName: string

  connectTimeout: number
  recvTimeout: number

  private _credentials?: DeviceCredentials
  private _initialized = false
  private _waveClient?: WaveClient

  constructor(options: ASRConfigOptions = {}) {
    this.url = options.url ?? WEBSOCKET_URL
    this.aid = options.aid ?? AID
    this.userAgent = options.userAgent ?? USER_AGENT
    this.deviceId = options.deviceId
    this.token = options.token
    if (options.credentials) {
      this._credentials = options.credentials
    }
    this.credentialPath = options.credentialPath
    this.opusEncoder = options.opusEncoder

    this.sampleRate = options.sampleRate ?? 16000
    this.channels = options.channels ?? 1
    this.frameDurationMs = options.frameDurationMs ?? 20

    this.enablePunctuation = options.enablePunctuation ?? true
    this.enableSpeechRejection = options.enableSpeechRejection ?? false
    this.enableAsrTwopass = options.enableAsrTwopass ?? true
    this.enableAsrThreepass = options.enableAsrThreepass ?? true
    this.appName = options.appName ?? 'com.android.chrome'

    this.connectTimeout = options.connectTimeout ?? 10000
    this.recvTimeout = options.recvTimeout ?? 10000
  }

  // ─── 凭据管理 ──────────────────────────────────────────────

  private loadCredentialsFromFile(): DeviceCredentials | null {
    if (!this.credentialPath) return null
    if (!existsSync(this.credentialPath)) return null

    try {
      const raw = readFileSync(this.credentialPath, 'utf-8')
      return JSON.parse(raw) as DeviceCredentials
    } catch {
      return null
    }
  }

  private saveCredentialsToFile(creds: DeviceCredentials): void {
    if (!this.credentialPath) return

    const dir = dirname(this.credentialPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(this.credentialPath, JSON.stringify(creds, null, 2), 'utf-8')
  }

  /**
   * 确保凭据已初始化
   *
   * 优先级：
   * 1. 直接传入的 deviceId/token 参数
   * 2. 直接传入的 credentials 对象
   * 3. credentialPath 文件中的值
   * 4. 自动注册获取
   */
  async ensureCredentials(): Promise<void> {
    if (this._initialized) return

    const userDeviceId = this.deviceId
    const userToken = this.token

    // 优先使用直接传入的 credentials 对象
    if (this._credentials) {
      if (!this.deviceId) this.deviceId = this._credentials.deviceId
      if (!this.token) this.token = this._credentials.token
    }

    // 尝试从文件加载
    if (!this._credentials) {
      const fileCreds = this.loadCredentialsFromFile()
      if (fileCreds) {
        this._credentials = fileCreds
        if (!this.deviceId) this.deviceId = fileCreds.deviceId
        if (!this.token) this.token = fileCreds.token
      }
    }

    // 如果 deviceId 仍为空，注册设备
    let needSave = false
    if (!this.deviceId) {
      this._credentials = await registerDevice()
      this.deviceId = this._credentials.deviceId
      needSave = true
    }

    // 如果 token 仍为空，获取 token
    if (!this.token) {
      const cdid = this._credentials?.cdid
      this.token = await getAsrToken(this.deviceId!, cdid)
    }

    // 保存凭据到文件
    if (this.credentialPath && needSave && this._credentials) {
      this._credentials.token = this.token
      this.saveCredentialsToFile(this._credentials)
    }

    // 用户显式传入的参数优先级最高
    if (userDeviceId) this.deviceId = userDeviceId
    if (userToken) this.token = userToken

    this._initialized = true
  }

  // ─── WebSocket 配置 ──────────────────────────────────────────

  get wsUrl(): string {
    return `${this.url}?aid=${this.aid}&device_id=${this.deviceId}`
  }

  get headers(): Record<string, string> {
    return {
      'User-Agent': this.userAgent,
      'proto-version': 'v2',
      'x-custom-keepalive': 'true'
    }
  }

  // ─── 会话配置 ──────────────────────────────────────────────

  sessionConfig(): SessionConfig {
    return {
      audio_info: {
        channel: this.channels,
        format: 'speech_opus',
        sample_rate: this.sampleRate
      },
      enable_punctuation: this.enablePunctuation,
      enable_speech_rejection: this.enableSpeechRejection,
      extra: {
        app_name: this.appName,
        cell_compress_rate: 8,
        did: this.deviceId!,
        enable_asr_threepass: this.enableAsrThreepass,
        enable_asr_twopass: this.enableAsrTwopass,
        input_mode: 'tool'
      }
    }
  }

  getToken(): string {
    return this.token!
  }

  // ─── Wave Client ──────────────────────────────────────────────

  private onWaveSessionUpdate(session: WaveSession): void {
    if (this._credentials) {
      this._credentials.waveSession = serializeSession(session)
      this.saveCredentialsToFile(this._credentials)
    }
  }

  getWaveClient(): WaveClient {
    if (!this._waveClient) {
      let cachedSession: WaveSession | null = null

      if (this._credentials?.waveSession) {
        try {
          const session = deserializeSession(this._credentials.waveSession)
          if (!isSessionExpired(session)) {
            cachedSession = session
          }
        } catch {
          // 缓存无效，忽略
        }
      }

      this._waveClient = new WaveClient(this.deviceId!, this.aid, cachedSession, (s) =>
        this.onWaveSessionUpdate(s)
      )
    }
    return this._waveClient
  }

  // ─── SAMI Token ──────────────────────────────────────────────

  async getSamiToken(): Promise<string> {
    // 优先使用缓存中未过期的 token
    if (this._credentials?.samiToken && !isJwtExpired(this._credentials.samiToken)) {
      return this._credentials.samiToken
    }

    const cdid = this._credentials?.cdid
    const samiToken = await getSamiToken(cdid)

    // 缓存
    if (this._credentials) {
      this._credentials.samiToken = samiToken
      this.saveCredentialsToFile(this._credentials)
    }

    return samiToken
  }
}
