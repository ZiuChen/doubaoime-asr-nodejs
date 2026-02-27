/**
 * 设备注册与 Token 获取
 *
 * 模拟豆包输入法客户端注册设备，获取 device_id 和 ASR token
 */

import {
  APP_CONFIG,
  DEFAULT_DEVICE_CONFIG,
  REGISTER_URL,
  SETTINGS_URL,
  USER_AGENT
} from '../constants.js'
import { md5Hex, randomHex, randomUUID } from '../utils/crypto.js'
import type { DeviceCredentials } from '../types.js'

// ─── 标识生成 ──────────────────────────────────────────────────

function generateCdid(): string {
  return randomUUID()
}

function generateOpenudid(): string {
  return randomHex(8)
}

function generateClientudid(): string {
  return randomUUID()
}

// ─── 设备注册 ──────────────────────────────────────────────────

function buildRegisterHeader(cdid: string, openudid: string, clientudid: string) {
  return {
    device_id: 0,
    install_id: 0,
    ...APP_CONFIG,
    ...DEFAULT_DEVICE_CONFIG,
    cdid,
    openudid,
    clientudid,
    region: 'CN',
    tz_name: 'Asia/Shanghai',
    tz_offset: 28800,
    sim_region: 'cn',
    carrier_region: 'cn',
    cpu_abi: 'arm64-v8a',
    build_serial: 'unknown',
    not_request_sender: 0,
    sig_hash: '',
    google_aid: '',
    mc: '',
    serial_number: ''
  }
}

function buildRegisterBody(header: ReturnType<typeof buildRegisterHeader>) {
  return {
    magic_tag: 'ss_app_log',
    header,
    _gen_time: Date.now()
  }
}

function buildRegisterParams(cdid: string): Record<string, string> {
  const appParams = {
    channel: APP_CONFIG.channel,
    aid: String(APP_CONFIG.aid),
    app_name: APP_CONFIG.app_name,
    version_code: String(APP_CONFIG.version_code),
    version_name: APP_CONFIG.version_name,
    manifest_version_code: String(APP_CONFIG.manifest_version_code),
    update_version_code: String(APP_CONFIG.update_version_code)
  }

  const deviceParams = {
    device_platform: DEFAULT_DEVICE_CONFIG.device_platform,
    os: DEFAULT_DEVICE_CONFIG.os,
    resolution: DEFAULT_DEVICE_CONFIG.resolution,
    dpi: DEFAULT_DEVICE_CONFIG.dpi,
    device_type: DEFAULT_DEVICE_CONFIG.device_type,
    device_brand: DEFAULT_DEVICE_CONFIG.device_brand,
    language: DEFAULT_DEVICE_CONFIG.language,
    os_api: DEFAULT_DEVICE_CONFIG.os_api,
    os_version: DEFAULT_DEVICE_CONFIG.os_version
  }

  return {
    ...deviceParams,
    ...appParams,
    ssmix: 'a',
    _rticket: String(Date.now()),
    cdid,
    ac: 'wifi'
  }
}

/**
 * 注册设备，获取 device_id 等信息
 */
export async function registerDevice(): Promise<DeviceCredentials> {
  const cdid = generateCdid()
  const openudid = generateOpenudid()
  const clientudid = generateClientudid()

  const header = buildRegisterHeader(cdid, openudid, clientudid)
  const body = buildRegisterBody(header)
  const params = buildRegisterParams(cdid)

  const url = new URL(REGISTER_URL)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  })

  if (!response.ok) {
    throw new Error(`Device registration failed: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    device_id: number
    install_id: number
    device_id_str?: string
    install_id_str?: string
  }

  if (!data.device_id || data.device_id === 0) {
    throw new Error('Device registration failed: no device_id returned')
  }

  return {
    deviceId: String(data.device_id),
    installId: String(data.install_id),
    cdid,
    openudid,
    clientudid
  }
}

// ─── ASR Token 获取 ──────────────────────────────────────────────

function buildSettingsParams(deviceId: string, cdid: string): Record<string, string> {
  return {
    device_platform: 'android',
    os: 'android',
    ssmix: 'a',
    _rticket: String(Date.now()),
    cdid,
    channel: APP_CONFIG.channel,
    aid: String(APP_CONFIG.aid),
    app_name: APP_CONFIG.app_name,
    version_code: String(APP_CONFIG.version_code),
    version_name: APP_CONFIG.version_name,
    device_id: deviceId
  }
}

/**
 * 获取 ASR token
 */
export async function getAsrToken(deviceId: string, cdid?: string): Promise<string> {
  const actualCdid = cdid ?? generateCdid()
  const params = buildSettingsParams(deviceId, actualCdid)

  const url = new URL(SETTINGS_URL)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const bodyStr = 'body=null'
  const xSsStub = md5Hex(bodyStr)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-ss-stub': xSsStub
    },
    body: bodyStr
  })

  if (!response.ok) {
    throw new Error(`Failed to get ASR token: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    data: {
      settings: {
        asr_config: {
          app_key: string
        }
      }
    }
    message: string
  }

  return data.data.settings.asr_config.app_key
}
