/**
 * 常量定义
 */

/** 设备注册 API URL */
export const REGISTER_URL = 'https://log.snssdk.com/service/2/device_register/'

/** Settings API URL（获取 Token） */
export const SETTINGS_URL = 'https://is.snssdk.com/service/settings/v3/'

/** ASR WebSocket URL */
export const WEBSOCKET_URL = 'wss://frontier-audio-ime-ws.doubao.com/ocean/api/v1/ws'

/** SAMI 配置接口 URL（获取 SAMI TOKEN） */
export const SAMI_CONFIG_URL = 'https://ime.oceancloudapi.com/api/v1/user/get_config'

/** Wave 加密协议握手 URL */
export const HANDSHAKE_URL = 'https://keyhub.zijieapi.com/handshake'

/** NER 接口 URL */
export const NER_URL = 'https://speech.bytedance.com/api/v3/context/ime/ner'

/** 豆包输入法的 APP ID */
export const AID = 401734

/** SAMI 语音相关的服务 APP KEY（写死在客户端的） */
export const SAMI_APP_KEY = 'SYlxZr6LnvBaIVmF'

/** HKDF info 字符串（写死在客户端的） */
export const HKDF_INFO = Buffer.from('4e30514609050cd3')

/** 应用配置（豆包输入法） */
export const APP_CONFIG = {
  aid: AID,
  app_name: 'oime',
  version_code: 100102018,
  version_name: '1.1.2',
  manifest_version_code: 100102018,
  update_version_code: 100102018,
  channel: 'official',
  package: 'com.bytedance.android.doubaoime'
} as const

/** 默认设备配置（模拟 Pixel 7 Pro） */
export const DEFAULT_DEVICE_CONFIG = {
  device_platform: 'android',
  os: 'android',
  os_api: '34',
  os_version: '16',
  device_type: 'Pixel 7 Pro',
  device_brand: 'google',
  device_model: 'Pixel 7 Pro',
  resolution: '1080*2400',
  dpi: '420',
  language: 'zh',
  timezone: 8,
  access: 'wifi',
  rom: 'UP1A.231005.007',
  rom_version: 'UP1A.231005.007'
} as const

export const USER_AGENT =
  'com.bytedance.android.doubaoime/100102018 (Linux; U; Android 16; en_US; Pixel 7 Pro; Build/BP2A.250605.031.A2; Cronet/TTNetVersion:94cf429a 2025-11-17 QuicVersion:1f89f732 2025-05-08)'
