/**
 * SAMI 服务相关
 *
 * 获取 SAMI Token（用于 NER 等服务）
 */

import {
  APP_CONFIG,
  DEFAULT_DEVICE_CONFIG,
  SAMI_APP_KEY,
  SAMI_CONFIG_URL,
  USER_AGENT
} from '../constants.js'
import { md5Hex, randomUUID } from '../utils/crypto.js'

function buildSamiParams(cdid: string): Record<string, string> {
  const appParams = {
    channel: APP_CONFIG.channel,
    app_name: APP_CONFIG.app_name,
    version_name: APP_CONFIG.version_name,
    aid: String(APP_CONFIG.aid),
    version_code: String(APP_CONFIG.version_code),
    manifest_version_code: String(APP_CONFIG.manifest_version_code),
    update_version_code: String(APP_CONFIG.update_version_code)
  }

  const deviceKeys = [
    'device_platform',
    'os',
    'resolution',
    'dpi',
    'device_type',
    'device_brand',
    'language',
    'os_api',
    'os_version'
  ] as const

  const deviceParams: Record<string, string> = {}
  for (const key of deviceKeys) {
    deviceParams[key] = String(DEFAULT_DEVICE_CONFIG[key])
  }

  return {
    ...deviceParams,
    ...appParams,
    ssmix: 'a',
    _rticket: String(Date.now()),
    cdid,
    ac: 'wifi',
    'use-olympus-account': '1'
  }
}

/**
 * 获取 SAMI token
 */
export async function getSamiToken(cdid?: string): Promise<string> {
  const actualCdid = cdid ?? randomUUID()
  const params = buildSamiParams(actualCdid)

  const url = new URL(SAMI_CONFIG_URL)
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value)
  }

  const bodyJson = JSON.stringify({ sami_app_key: SAMI_APP_KEY })
  const xSsStub = md5Hex(bodyJson)

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'User-Agent': USER_AGENT,
      'Content-Type': 'application/json',
      app_version: APP_CONFIG.version_name,
      app_id: String(APP_CONFIG.aid),
      os_type: 'Android',
      'x-ss-stub': xSsStub
    },
    body: bodyJson
  })

  if (!response.ok) {
    throw new Error(`Failed to get SAMI token: HTTP ${response.status}`)
  }

  const data = (await response.json()) as {
    code: number
    msg: string
    data: { sami_token: string }
  }

  return data.data.sami_token
}
