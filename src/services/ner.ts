/**
 * NER (Named Entity Recognition) 服务
 *
 * 通过 Wave 加密协议调用 NER 接口
 */

import { AID, APP_CONFIG, NER_URL, SAMI_APP_KEY } from '../constants.js'
import { randomUUID } from '../utils/crypto.js'
import type { ASRConfig } from './config.js'
import type { NerResponse } from '../types.js'

/**
 * 调用 NER 接口
 *
 * @param config ASR 配置（需已初始化凭据）
 * @param text 需要进行 NER 的文本
 * @param appName 应用名称（可选）
 */
export async function ner(config: ASRConfig, text: string, appName = ''): Promise<NerResponse> {
  await config.ensureCredentials()

  const waveClient = config.getWaveClient()
  const samiToken = await config.getSamiToken()

  const request = {
    user: {
      uid: '0',
      did: config.deviceId!,
      app_name: appName,
      app_version: APP_CONFIG.version_name,
      sdk_version: '',
      platform: 'android',
      experience_improve: false
    },
    text,
    additions: {}
  }

  const extraHeaders: Record<string, string> = {
    app_version: APP_CONFIG.version_name,
    app_id: String(AID),
    os_type: 'android',
    'x-api-resource-id': 'asr.user.context',
    'x-api-app-key': SAMI_APP_KEY,
    'x-api-token': samiToken,
    'x-api-request-id': randomUUID()
  }

  const reqData = Buffer.from(JSON.stringify(request))
  const [payload, headers] = await waveClient.prepareRequest(reqData, extraHeaders)

  const response = await fetch(NER_URL, {
    method: 'POST',
    headers,
    body: payload
  })

  if (!response.ok) {
    throw new Error(`NER request failed: HTTP ${response.status}`)
  }

  const nonce = Buffer.from(response.headers.get('x-tt-e-p')!, 'base64')
  const ciphertext = Buffer.from(await response.arrayBuffer())
  const decoded = waveClient.decrypt(ciphertext, nonce)

  return JSON.parse(decoded.toString()) as NerResponse
}
