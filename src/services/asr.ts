/**
 * 豆包输入法 ASR 客户端
 *
 * 基于 WebSocket 的语音识别客户端，支持：
 * - 非流式识别 (transcribe)
 * - 流式识别 (transcribeStream)
 * - 实时流式识别 (transcribeRealtime)
 */

import WebSocket from 'ws'
import crypto from 'node:crypto'
import { create, toBinary } from '@bufbuild/protobuf'

import { ASRConfig, type ASRConfigOptions } from './config.js'
import { loadAudioFile, pcmToOpusFrames } from '../utils/audio.js'
import { parseResponse } from '../utils/response-parser.js'
import { AsrRequestSchema, FrameState } from '../gen/proto/asr_pb.js'
import { ResponseType } from '../types.js'
import type { ASRResponse, AudioChunk } from '../types.js'

// ─── 错误类 ──────────────────────────────────────────────────

export class ASRError extends Error {
  response?: ASRResponse

  constructor(message: string, response?: ASRResponse) {
    super(message)
    this.name = 'ASRError'
    this.response = response
  }
}

// ─── 异步队列 ──────────────────────────────────────────────────

class AsyncQueue<T> {
  private items: T[] = []
  private resolvers: Array<(value: T) => void> = []

  push(item: T): void {
    const resolver = this.resolvers.shift()
    if (resolver) {
      resolver(item)
    } else {
      this.items.push(item)
    }
  }

  pop(): Promise<T> {
    const item = this.items.shift()
    if (item !== undefined) return Promise.resolve(item)
    return new Promise<T>((resolve) => {
      this.resolvers.push(resolve)
    })
  }

  /** 带超时的 pop */
  popWithTimeout(timeoutMs: number): Promise<T | null> {
    return new Promise<T | null>((resolve) => {
      const item = this.items.shift()
      if (item !== undefined) {
        resolve(item)
        return
      }

      let settled = false
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          // 从 resolvers 中移除
          const idx = this.resolvers.indexOf(wrappedResolve)
          if (idx !== -1) this.resolvers.splice(idx, 1)
          resolve(null)
        }
      }, timeoutMs)

      const wrappedResolve = (value: T) => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          resolve(value)
        }
      }

      this.resolvers.push(wrappedResolve)
    })
  }
}

// ─── 会话状态 ──────────────────────────────────────────────────

interface SessionState {
  requestId: string
  finalText: string
  isFinished: boolean
  error?: ASRResponse
}

function createSessionState(): SessionState {
  return {
    requestId: crypto.randomUUID(),
    finalText: '',
    isFinished: false
  }
}

// ─── Protobuf 消息构建 ──────────────────────────────────────────

function buildStartTask(requestId: string, token: string): Buffer {
  const msg = create(AsrRequestSchema, {
    token,
    serviceName: 'ASR',
    methodName: 'StartTask',
    requestId
  })
  return Buffer.from(toBinary(AsrRequestSchema, msg))
}

function buildStartSession(
  requestId: string,
  token: string,
  config: import('../types.js').SessionConfig
): Buffer {
  const msg = create(AsrRequestSchema, {
    token,
    serviceName: 'ASR',
    methodName: 'StartSession',
    requestId,
    payload: JSON.stringify(config)
  })
  return Buffer.from(toBinary(AsrRequestSchema, msg))
}

function buildFinishSession(requestId: string, token: string): Buffer {
  const msg = create(AsrRequestSchema, {
    token,
    serviceName: 'ASR',
    methodName: 'FinishSession',
    requestId
  })
  return Buffer.from(toBinary(AsrRequestSchema, msg))
}

function buildAudioRequest(
  audioData: Buffer,
  requestId: string,
  frameState: FrameState,
  timestampMs: number
): Buffer {
  const metadata = JSON.stringify({ extra: {}, timestamp_ms: timestampMs })
  const msg = create(AsrRequestSchema, {
    serviceName: 'ASR',
    methodName: 'TaskRequest',
    payload: metadata,
    audioData: new Uint8Array(audioData),
    requestId,
    frameState
  })
  return Buffer.from(toBinary(AsrRequestSchema, msg))
}

// ─── WebSocket 辅助 ──────────────────────────────────────────────

function connectWs(
  url: string,
  headers: Record<string, string>,
  timeout: number
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { headers, handshakeTimeout: timeout })

    const onOpen = () => {
      cleanup()
      resolve(ws)
    }

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    const cleanup = () => {
      ws.removeListener('open', onOpen)
      ws.removeListener('error', onError)
    }

    ws.on('open', onOpen)
    ws.on('error', onError)
  })
}

function wsSend(ws: WebSocket, data: Buffer): Promise<void> {
  return new Promise((resolve, reject) => {
    ws.send(data, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

function wsRecv(ws: WebSocket): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const onMessage = (data: WebSocket.RawData) => {
      cleanup()
      resolve(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
    }

    const onError = (err: Error) => {
      cleanup()
      reject(err)
    }

    const onClose = () => {
      cleanup()
      reject(new Error('WebSocket closed'))
    }

    const cleanup = () => {
      ws.removeListener('message', onMessage)
      ws.removeListener('error', onError)
      ws.removeListener('close', onClose)
    }

    ws.on('message', onMessage)
    ws.on('error', onError)
    ws.on('close', onClose)
  })
}

// ─── DoubaoASR 客户端 ──────────────────────────────────────────

export interface TranscribeOptions {
  /** 是否按实时速度发送 */
  realtime?: boolean
  /** 中间结果回调 */
  onInterim?: (text: string) => void
}

export class DoubaoASR {
  config: ASRConfig

  constructor(config?: ASRConfig | ASRConfigOptions) {
    if (config instanceof ASRConfig) {
      this.config = config
    } else {
      this.config = new ASRConfig(config)
    }
  }

  /**
   * 非流式语音识别
   *
   * @param audio WAV 文件路径或 PCM Buffer
   * @param options 选项
   * @returns 最终识别文本
   */
  async transcribe(audio: string | Buffer, options?: TranscribeOptions): Promise<string> {
    let finalText = ''

    for await (const response of this.transcribeStream(audio, options)) {
      if (response.type === ResponseType.INTERIM_RESULT && options?.onInterim) {
        options.onInterim(response.text)
      } else if (response.type === ResponseType.FINAL_RESULT) {
        finalText = response.text
      } else if (response.type === ResponseType.ERROR) {
        throw new ASRError(response.errorMsg, response)
      }
    }

    return finalText
  }

  /**
   * 流式语音识别（完整音频）
   *
   * @param audio WAV 文件路径或 PCM Buffer
   * @param options 选项
   * @yields ASR 响应流
   */
  async *transcribeStream(
    audio: string | Buffer,
    options?: TranscribeOptions
  ): AsyncGenerator<ASRResponse> {
    await this.config.ensureCredentials()

    if (!this.config.opusEncoder) {
      throw new ASRError(
        'Opus encoder is required. Please provide an OpusEncoder instance via config.opusEncoder. ' +
          'See README for supported Opus libraries.'
      )
    }

    // 获取 PCM 数据
    const pcmData =
      typeof audio === 'string'
        ? loadAudioFile(audio, this.config.sampleRate, this.config.channels)
        : audio

    // 编码为 Opus 帧
    const opusFrames = pcmToOpusFrames(
      pcmData,
      this.config.opusEncoder,
      this.config.sampleRate,
      this.config.frameDurationMs
    )

    const state = createSessionState()

    let ws: WebSocket | undefined
    try {
      ws = await connectWs(this.config.wsUrl, this.config.headers, this.config.connectTimeout)

      // 初始化会话
      yield* this.initializeSession(ws, state)

      // 响应队列
      const queue = new AsyncQueue<ASRResponse | null>()

      // 启动接收
      const recvPromise = this.receiveResponses(ws, state, queue)

      // 启动发送
      const sendPromise = this.sendAudio(ws, opusFrames, state, !!options?.realtime)

      // 从队列获取响应
      try {
        while (true) {
          const resp = await queue.popWithTimeout(this.config.recvTimeout)

          if (resp === null) break // null = 超时或结束标记

          if (resp.type === ResponseType.HEARTBEAT) continue

          yield resp

          if (resp.type === ResponseType.ERROR) break
        }

        await sendPromise
      } finally {
        // 清理
        await Promise.allSettled([sendPromise, recvPromise])
      }
    } catch (err) {
      if (err instanceof ASRError) throw err
      throw new ASRError(`WebSocket error: ${(err as Error).message}`)
    } finally {
      ws?.close()
    }
  }

  /**
   * 实时流式语音识别（支持麦克风等持续音频源）
   *
   * @param audioSource PCM 音频数据的异步迭代器
   * @yields ASR 响应流
   */
  async *transcribeRealtime(audioSource: AsyncIterable<AudioChunk>): AsyncGenerator<ASRResponse> {
    await this.config.ensureCredentials()

    if (!this.config.opusEncoder) {
      throw new ASRError(
        'Opus encoder is required. Please provide an OpusEncoder instance via config.opusEncoder.'
      )
    }

    const state = createSessionState()

    let ws: WebSocket | undefined
    try {
      ws = await connectWs(this.config.wsUrl, this.config.headers, this.config.connectTimeout)

      yield* this.initializeSession(ws, state)

      const queue = new AsyncQueue<ASRResponse | null>()

      const recvPromise = this.receiveResponses(ws, state, queue)
      const sendPromise = this.sendAudioRealtime(ws, audioSource, state)

      try {
        while (true) {
          const resp = await queue.pop()

          if (resp === null) break

          if (resp.type === ResponseType.HEARTBEAT) continue

          yield resp

          if (resp.type === ResponseType.ERROR) break
        }

        await sendPromise
      } finally {
        await Promise.allSettled([sendPromise, recvPromise])
      }
    } catch (err) {
      if (err instanceof ASRError) throw err
      throw new ASRError(`WebSocket error: ${(err as Error).message}`)
    } finally {
      ws?.close()
    }
  }

  // ─── 内部方法 ──────────────────────────────────────────────

  private async *initializeSession(
    ws: WebSocket,
    state: SessionState
  ): AsyncGenerator<ASRResponse> {
    const token = this.config.getToken()

    // StartTask
    await wsSend(ws, buildStartTask(state.requestId, token))
    const taskResp = parseResponse(await wsRecv(ws))
    if (taskResp.type === ResponseType.ERROR) {
      throw new ASRError(`StartTask failed: ${taskResp.errorMsg}`, taskResp)
    }
    yield taskResp

    // StartSession
    await wsSend(ws, buildStartSession(state.requestId, token, this.config.sessionConfig()))
    const sessionResp = parseResponse(await wsRecv(ws))
    if (sessionResp.type === ResponseType.ERROR) {
      throw new ASRError(`StartSession failed: ${sessionResp.errorMsg}`, sessionResp)
    }
    yield sessionResp
  }

  private async sendAudio(
    ws: WebSocket,
    opusFrames: Buffer[],
    state: SessionState,
    realtime: boolean
  ): Promise<void> {
    const timestampMs = Date.now()
    const frameInterval = this.config.frameDurationMs

    for (let i = 0; i < opusFrames.length; i++) {
      if (state.isFinished) break

      let frameState: FrameState
      if (i === 0) frameState = FrameState.FIRST
      else if (i === opusFrames.length - 1) frameState = FrameState.LAST
      else frameState = FrameState.MIDDLE

      const msg = buildAudioRequest(
        opusFrames[i]!,
        state.requestId,
        frameState,
        timestampMs + i * frameInterval
      )
      await wsSend(ws, msg)

      if (realtime) {
        await sleep(frameInterval)
      }
    }

    // FinishSession
    await wsSend(ws, buildFinishSession(state.requestId, this.config.getToken()))
  }

  private async sendAudioRealtime(
    ws: WebSocket,
    audioSource: AsyncIterable<AudioChunk>,
    state: SessionState
  ): Promise<void> {
    const encoder = this.config.opusEncoder!
    const timestampMs = Date.now()
    const frameDurationMs = this.config.frameDurationMs
    const samplesPerFrame = (this.config.sampleRate * frameDurationMs) / 1000
    const bytesPerFrame = samplesPerFrame * 2 // 16-bit
    let frameIndex = 0
    let pcmBuffer = Buffer.alloc(0)

    for await (const chunk of audioSource) {
      if (state.isFinished) break

      pcmBuffer = Buffer.concat([pcmBuffer, chunk])

      while (pcmBuffer.length >= bytesPerFrame) {
        const pcmFrame = pcmBuffer.subarray(0, bytesPerFrame)
        pcmBuffer = pcmBuffer.subarray(bytesPerFrame)

        const opusFrame = encoder.encode(pcmFrame, samplesPerFrame)

        const frameState = frameIndex === 0 ? FrameState.FIRST : FrameState.MIDDLE

        const msg = buildAudioRequest(
          opusFrame,
          state.requestId,
          frameState,
          timestampMs + frameIndex * frameDurationMs
        )
        await wsSend(ws, msg)
        frameIndex++
      }
    }

    // 处理剩余数据
    if (pcmBuffer.length > 0 && !state.isFinished) {
      if (pcmBuffer.length < bytesPerFrame) {
        const padded = Buffer.alloc(bytesPerFrame)
        pcmBuffer.copy(padded)
        pcmBuffer = padded
      }

      const opusFrame = encoder.encode(pcmBuffer, samplesPerFrame)
      const msg = buildAudioRequest(
        opusFrame,
        state.requestId,
        FrameState.LAST,
        timestampMs + frameIndex * frameDurationMs
      )
      await wsSend(ws, msg)
    } else if (frameIndex > 0 && !state.isFinished) {
      // 发送静音 LAST 帧
      const silent = Buffer.alloc(bytesPerFrame)
      const opusFrame = encoder.encode(silent, samplesPerFrame)
      const msg = buildAudioRequest(
        opusFrame,
        state.requestId,
        FrameState.LAST,
        timestampMs + frameIndex * frameDurationMs
      )
      await wsSend(ws, msg)
    }

    // FinishSession
    if (!state.isFinished) {
      await wsSend(ws, buildFinishSession(state.requestId, this.config.getToken()))
    }
  }

  private async receiveResponses(
    ws: WebSocket,
    state: SessionState,
    queue: AsyncQueue<ASRResponse | null>
  ): Promise<void> {
    const messageHandler = (data: WebSocket.RawData) => {
      if (state.isFinished) return

      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
      const resp = parseResponse(buf)

      if (resp.type === ResponseType.ERROR) {
        state.error = resp
        state.isFinished = true
        queue.push(resp)
      } else if (resp.type === ResponseType.SESSION_FINISHED) {
        state.isFinished = true
        queue.push(resp)
      } else if (resp.type === ResponseType.FINAL_RESULT) {
        state.finalText = resp.text
        queue.push(resp)
      } else {
        queue.push(resp)
      }
    }

    const closeHandler = () => {
      state.isFinished = true
      queue.push(null)
    }

    const errorHandler = () => {
      state.isFinished = true
      queue.push(null)
    }

    ws.on('message', messageHandler)
    ws.on('close', closeHandler)
    ws.on('error', errorHandler)

    // 等待结束
    await new Promise<void>((resolve) => {
      const check = () => {
        if (state.isFinished) {
          ws.removeListener('message', messageHandler)
          ws.removeListener('close', closeHandler)
          ws.removeListener('error', errorHandler)
          queue.push(null) // 结束标记
          resolve()
        } else {
          setTimeout(check, 100)
        }
      }
      check()
    })
  }
}

// ─── 便捷函数 ──────────────────────────────────────────────────

/**
 * 非流式语音识别
 *
 * @param audio WAV 文件路径或 PCM Buffer
 * @param options 配置和选项
 * @returns 最终识别文本
 */
export async function transcribe(
  audio: string | Buffer,
  options?: {
    config?: ASRConfig | ASRConfigOptions
    onInterim?: (text: string) => void
    realtime?: boolean
  }
): Promise<string> {
  const asr = new DoubaoASR(options?.config)
  return asr.transcribe(audio, {
    onInterim: options?.onInterim,
    realtime: options?.realtime
  })
}

/**
 * 流式语音识别（完整音频）
 *
 * @param audio WAV 文件路径或 PCM Buffer
 * @param options 配置和选项
 * @yields ASRResponse 对象
 */
export async function* transcribeStream(
  audio: string | Buffer,
  options?: {
    config?: ASRConfig | ASRConfigOptions
    realtime?: boolean
  }
): AsyncGenerator<ASRResponse> {
  const asr = new DoubaoASR(options?.config)
  yield* asr.transcribeStream(audio, { realtime: options?.realtime })
}

/**
 * 实时流式语音识别
 *
 * @param audioSource PCM 音频数据的异步迭代器
 * @param options 配置
 * @yields ASRResponse 对象
 */
export async function* transcribeRealtime(
  audioSource: AsyncIterable<AudioChunk>,
  options?: {
    config?: ASRConfig | ASRConfigOptions
  }
): AsyncGenerator<ASRResponse> {
  const asr = new DoubaoASR(options?.config)
  yield* asr.transcribeRealtime(audioSource)
}

// ─── 工具函数 ──────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
