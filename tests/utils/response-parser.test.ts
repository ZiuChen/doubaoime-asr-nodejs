import { describe, expect, test } from 'vitest'
import { fromBinary } from '@bufbuild/protobuf'
import { AsrResponseSchema } from '../../src/gen/proto/asr_pb.js'
import {
  parseResponse,
  parseWord,
  parseAlternative,
  parseResult,
  parseExtra,
  createResponse
} from '../../src/utils/response-parser.js'
import { ResponseType } from '../../src/types.js'

// 辅助函数：构造 protobuf 二进制数据
function buildPbResponse(fields: Record<number, string | number>): Uint8Array {
  const parts: Buffer[] = []
  for (const [field, value] of Object.entries(fields)) {
    const fieldNum = Number(field)
    if (typeof value === 'string') {
      const buf = Buffer.from(value, 'utf-8')
      parts.push(Buffer.from([(fieldNum << 3) | 2, buf.length]))
      parts.push(buf)
    } else if (typeof value === 'number') {
      // varint encoding for small positive numbers
      parts.push(Buffer.from([(fieldNum << 3) | 0, value]))
    }
  }
  return new Uint8Array(Buffer.concat(parts))
}

describe('response-parser', () => {
  describe('parseWord', () => {
    test('parses word data', () => {
      const result = parseWord({ word: 'hello', start_time: 100, end_time: 200 })
      expect(result).toEqual({ word: 'hello', startTime: 100, endTime: 200 })
    })

    test('handles missing fields', () => {
      const result = parseWord({})
      expect(result).toEqual({ word: '', startTime: 0, endTime: 0 })
    })
  })

  describe('parseAlternative', () => {
    test('parses alternative with words', () => {
      const result = parseAlternative({
        text: 'hello world',
        start_time: 0,
        end_time: 500,
        words: [
          { word: 'hello', start_time: 0, end_time: 200 },
          { word: 'world', start_time: 200, end_time: 500 }
        ]
      })
      expect(result.text).toBe('hello world')
      expect(result.words.length).toBe(2)
      expect(result.words[0].word).toBe('hello')
    })
  })

  describe('parseResult', () => {
    test('parses result data', () => {
      const result = parseResult({
        text: 'test',
        start_time: 0,
        end_time: 100,
        confidence: 0.95,
        alternatives: [],
        is_interim: false,
        is_vad_finished: true,
        index: 0
      })
      expect(result.text).toBe('test')
      expect(result.confidence).toBe(0.95)
      expect(result.isInterim).toBe(false)
      expect(result.isVadFinished).toBe(true)
    })
  })

  describe('parseExtra', () => {
    test('parses extra data', () => {
      const result = parseExtra({ audio_duration: 1000, packet_number: 5 })
      expect(result.audioDuration).toBe(1000)
      expect(result.packetNumber).toBe(5)
    })
  })

  describe('createResponse', () => {
    test('creates default response with overrides', () => {
      const resp = createResponse({ type: ResponseType.TASK_STARTED })
      expect(resp.type).toBe(ResponseType.TASK_STARTED)
      expect(resp.text).toBe('')
      expect(resp.isFinal).toBe(false)
      expect(resp.results).toEqual([])
    })
  })

  describe('parseResponse', () => {
    test('TaskStarted', () => {
      const data = buildPbResponse({ 4: 'TaskStarted' })
      const resp = parseResponse(data)
      expect(resp.type).toBe(ResponseType.TASK_STARTED)
    })

    test('SessionStarted', () => {
      const data = buildPbResponse({ 4: 'SessionStarted' })
      const resp = parseResponse(data)
      expect(resp.type).toBe(ResponseType.SESSION_STARTED)
    })

    test('SessionFinished', () => {
      const data = buildPbResponse({ 4: 'SessionFinished' })
      const resp = parseResponse(data)
      expect(resp.type).toBe(ResponseType.SESSION_FINISHED)
    })

    test('TaskFailed returns error', () => {
      const data = buildPbResponse({ 4: 'TaskFailed', 6: 'something went wrong' })
      const resp = parseResponse(data)
      expect(resp.type).toBe(ResponseType.ERROR)
      expect(resp.errorMsg).toBe('something went wrong')
    })

    test('heartbeat (no results)', () => {
      const json = JSON.stringify({ extra: { packet_number: 3 } })
      const data = buildPbResponse({ 4: 'result', 7: json })
      const resp = parseResponse(data)
      expect(resp.type).toBe(ResponseType.HEARTBEAT)
      expect(resp.packetNumber).toBe(3)
    })

    test('interim result', () => {
      const json = JSON.stringify({
        results: [{ text: 'hello', is_interim: true, is_vad_finished: false, alternatives: [] }],
        extra: {}
      })
      const data = buildPbResponse({ 4: 'result', 7: json })
      const resp = parseResponse(data)
      expect(resp.type).toBe(ResponseType.INTERIM_RESULT)
      expect(resp.text).toBe('hello')
      expect(resp.isFinal).toBe(false)
    })

    test('final result', () => {
      const json = JSON.stringify({
        results: [
          { text: 'hello world', is_interim: false, is_vad_finished: true, alternatives: [] }
        ],
        extra: {}
      })
      const data = buildPbResponse({ 4: 'result', 7: json })
      const resp = parseResponse(data)
      expect(resp.type).toBe(ResponseType.FINAL_RESULT)
      expect(resp.text).toBe('hello world')
      expect(resp.isFinal).toBe(true)
    })

    test('vad start', () => {
      const json = JSON.stringify({
        results: [{ text: '', alternatives: [] }],
        extra: { vad_start: true }
      })
      const data = buildPbResponse({ 4: 'result', 7: json })
      const resp = parseResponse(data)
      expect(resp.type).toBe(ResponseType.VAD_START)
      expect(resp.vadStart).toBe(true)
    })
  })
})
