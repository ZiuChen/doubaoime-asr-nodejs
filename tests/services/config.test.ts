import { describe, expect, test } from 'vitest'
import { ASRConfig } from '../../src/services/config.js'

describe('ASRConfig', () => {
  test('default config values', () => {
    const config = new ASRConfig()
    expect(config.sampleRate).toBe(16000)
    expect(config.channels).toBe(1)
    expect(config.frameDurationMs).toBe(20)
    expect(config.enablePunctuation).toBe(true)
    expect(config.enableAsrTwopass).toBe(true)
    expect(config.enableAsrThreepass).toBe(true)
    expect(config.connectTimeout).toBe(10000)
    expect(config.recvTimeout).toBe(10000)
  })

  test('custom config values', () => {
    const config = new ASRConfig({
      sampleRate: 8000,
      channels: 2,
      enablePunctuation: false,
      deviceId: 'test-device',
      token: 'test-token'
    })
    expect(config.sampleRate).toBe(8000)
    expect(config.channels).toBe(2)
    expect(config.enablePunctuation).toBe(false)
    expect(config.deviceId).toBe('test-device')
    expect(config.token).toBe('test-token')
  })

  test('sessionConfig generates correct structure', () => {
    const config = new ASRConfig({ deviceId: 'dev-123', token: 'tok' })
    ;(config as any)._initialized = true

    const session = config.sessionConfig()
    expect(session.audio_info.format).toBe('speech_opus')
    expect(session.audio_info.sample_rate).toBe(16000)
    expect(session.audio_info.channel).toBe(1)
    expect(session.enable_punctuation).toBe(true)
    expect(session.extra.did).toBe('dev-123')
    expect(session.extra.input_mode).toBe('tool')
  })

  test('headers include required fields', () => {
    const config = new ASRConfig()
    expect(config.headers).toHaveProperty('User-Agent')
    expect(config.headers['proto-version']).toBe('v2')
    expect(config.headers['x-custom-keepalive']).toBe('true')
  })

  test('wsUrl includes aid and device_id', () => {
    const config = new ASRConfig({ deviceId: 'dev-abc' })
    expect(config.wsUrl).toContain('aid=401734')
    expect(config.wsUrl).toContain('device_id=dev-abc')
  })

  test('credentials object sets deviceId and token', async () => {
    const config = new ASRConfig({
      credentials: {
        deviceId: 'cred-device',
        token: 'cred-token',
        cdid: 'cred-cdid'
      }
    })
    await config.ensureCredentials()
    expect(config.deviceId).toBe('cred-device')
    expect(config.token).toBe('cred-token')
  })

  test('explicit deviceId/token take precedence over credentials object', async () => {
    const config = new ASRConfig({
      deviceId: 'explicit-device',
      token: 'explicit-token',
      credentials: {
        deviceId: 'cred-device',
        token: 'cred-token'
      }
    })
    await config.ensureCredentials()
    expect(config.deviceId).toBe('explicit-device')
    expect(config.token).toBe('explicit-token')
  })
})
