import { describe, expect, test } from 'vitest'
import { create, toBinary, fromBinary } from '@bufbuild/protobuf'
import { AsrRequestSchema, AsrResponseSchema, FrameState } from '../../src/gen/proto/asr_pb.js'

describe('protobuf (protobuf-es)', () => {
  test('encode AsrRequest: StartTask', () => {
    const msg = create(AsrRequestSchema, {
      token: 'test-token',
      serviceName: 'ASR',
      methodName: 'StartTask',
      requestId: 'req-123'
    })
    const buf = toBinary(AsrRequestSchema, msg)

    expect(buf).toBeInstanceOf(Uint8Array)
    expect(buf.length).toBeGreaterThan(0)
  })

  test('encode AsrRequest: TaskRequest with audio data', () => {
    const audioData = new Uint8Array([0x01, 0x02, 0x03, 0x04])
    const msg = create(AsrRequestSchema, {
      serviceName: 'ASR',
      methodName: 'TaskRequest',
      payload: '{"extra":{},"timestamp_ms":1234}',
      audioData,
      requestId: 'req-456',
      frameState: FrameState.FIRST
    })
    const buf = toBinary(AsrRequestSchema, msg)

    expect(buf.length).toBeGreaterThan(0)
  })

  test('encode AsrRequest: empty message', () => {
    const msg = create(AsrRequestSchema)
    const buf = toBinary(AsrRequestSchema, msg)
    // 空消息 protobuf-es 编码也是 0 字节
    expect(buf.length).toBe(0)
  })

  test('decode AsrResponse: TaskStarted', () => {
    // 手动构造一个 TaskStarted response protobuf
    // field 4 (message_type) = "TaskStarted"
    const messageType = Buffer.from('TaskStarted', 'utf-8')
    const tag = Buffer.from([(4 << 3) | 2]) // field 4, wire type 2
    const length = Buffer.from([messageType.length])
    const data = new Uint8Array(Buffer.concat([tag, length, messageType]))

    const resp = fromBinary(AsrResponseSchema, data)
    expect(resp.messageType).toBe('TaskStarted')
    expect(resp.statusCode).toBe(0)
    expect(resp.resultJson).toBe('')
  })

  test('decode AsrResponse: with result_json', () => {
    // field 4: message_type = "result"
    const mt = Buffer.from('result', 'utf-8')
    const mtPart = Buffer.concat([Buffer.from([(4 << 3) | 2, mt.length]), mt])

    // field 7: result_json = '{"results":[]}'
    const rj = Buffer.from('{"results":[]}', 'utf-8')
    const rjPart = Buffer.concat([Buffer.from([(7 << 3) | 2, rj.length]), rj])

    const data = new Uint8Array(Buffer.concat([mtPart, rjPart]))
    const resp = fromBinary(AsrResponseSchema, data)

    expect(resp.messageType).toBe('result')
    expect(resp.resultJson).toBe('{"results":[]}')
  })

  test('roundtrip: encode → decode', () => {
    const msg = create(AsrRequestSchema, {
      token: 'abc',
      serviceName: 'ASR',
      methodName: 'StartTask',
      requestId: 'id1'
    })
    const buf = toBinary(AsrRequestSchema, msg)

    // token "abc" = field 2, wire type 2 -> tag = 0x12, length = 3
    expect(buf[0]).toBe(0x12)
    expect(buf[1]).toBe(3)
    expect(Buffer.from(buf.subarray(2, 5)).toString()).toBe('abc')
  })

  test('FrameState enum values', () => {
    expect(FrameState.UNSPECIFIED).toBe(0)
    expect(FrameState.FIRST).toBe(1)
    expect(FrameState.MIDDLE).toBe(3)
    expect(FrameState.LAST).toBe(9)
  })
})
