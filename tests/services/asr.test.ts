import { describe, expect, test } from 'vitest'
import { DoubaoASR, ASRError } from '../../src/services/asr.js'
import { ASRConfig } from '../../src/services/config.js'
import { ResponseType } from '../../src/types.js'
import type { ASRResponse } from '../../src/types.js'

describe('DoubaoASR', () => {
  test('constructor accepts ASRConfig', () => {
    const config = new ASRConfig({ deviceId: 'test' })
    const asr = new DoubaoASR(config)
    expect(asr.config).toBe(config)
  })

  test('constructor accepts plain options', () => {
    const asr = new DoubaoASR({ deviceId: 'test', sampleRate: 8000 })
    expect(asr.config.deviceId).toBe('test')
    expect(asr.config.sampleRate).toBe(8000)
  })

  test('transcribe throws without opus encoder', async () => {
    const asr = new DoubaoASR({ deviceId: 'test', token: 'tok' })
    await expect(asr.transcribe(Buffer.alloc(100))).rejects.toThrow('Opus encoder is required')
  })
})

describe('ASRError', () => {
  test('basic error', () => {
    const err = new ASRError('test error')
    expect(err.message).toBe('test error')
    expect(err.name).toBe('ASRError')
    expect(err.response).toBeUndefined()
  })

  test('error with response', () => {
    const response: ASRResponse = {
      type: ResponseType.ERROR,
      text: '',
      isFinal: false,
      vadStart: false,
      vadFinished: false,
      packetNumber: -1,
      errorMsg: 'something failed',
      results: []
    }
    const err = new ASRError('test', response)
    expect(err.response).toBe(response)
  })
})

describe('ResponseType enum', () => {
  test('values', () => {
    expect(ResponseType.TASK_STARTED).toBe('TaskStarted')
    expect(ResponseType.FINAL_RESULT).toBe('FinalResult')
    expect(ResponseType.ERROR).toBe('Error')
  })
})
