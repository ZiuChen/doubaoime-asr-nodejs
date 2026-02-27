/**
 * ASR 响应解析器
 *
 * 纯函数：将 protobuf 二进制数据解析为结构化的 ASRResponse
 */

import { fromBinary } from '@bufbuild/protobuf'
import { AsrResponseSchema } from '../gen/proto/asr_pb.js'
import { ResponseType } from '../types.js'
import type {
  ASRAlternative,
  ASRExtra,
  ASRResponse,
  ASRResult,
  ASRWord,
  OIDecodingInfo
} from '../types.js'

// ─── 子结构解析（纯函数） ──────────────────────────────────────

export function parseWord(data: Record<string, unknown>): ASRWord {
  return {
    word: (data.word as string) ?? '',
    startTime: (data.start_time as number) ?? 0,
    endTime: (data.end_time as number) ?? 0
  }
}

export function parseOIDecodingInfo(
  data?: Record<string, unknown> | null
): OIDecodingInfo | undefined {
  if (!data) return undefined
  return {
    oiFormerWordNum: (data.oi_former_word_num as number) ?? 0,
    oiLatterWordNum: (data.oi_latter_word_num as number) ?? 0,
    oiWords: data.oi_words as unknown[]
  }
}

export function parseAlternative(data: Record<string, unknown>): ASRAlternative {
  const wordsRaw = (data.words as Record<string, unknown>[]) ?? []
  return {
    text: (data.text as string) ?? '',
    startTime: (data.start_time as number) ?? 0,
    endTime: (data.end_time as number) ?? 0,
    words: wordsRaw.map(parseWord),
    semanticRelatedToPrev: data.semantic_related_to_prev as boolean | undefined,
    oiDecodingInfo: parseOIDecodingInfo(
      data.oi_decoding_info as Record<string, unknown> | undefined
    )
  }
}

export function parseResult(data: Record<string, unknown>): ASRResult {
  const alternativesRaw = (data.alternatives as Record<string, unknown>[]) ?? []
  return {
    text: (data.text as string) ?? '',
    startTime: (data.start_time as number) ?? 0,
    endTime: (data.end_time as number) ?? 0,
    confidence: (data.confidence as number) ?? 0,
    alternatives: alternativesRaw.map(parseAlternative),
    isInterim: (data.is_interim as boolean) ?? true,
    isVadFinished: (data.is_vad_finished as boolean) ?? false,
    index: (data.index as number) ?? 0
  }
}

export function parseExtra(data: Record<string, unknown>): ASRExtra {
  return {
    audioDuration: data.audio_duration as number | undefined,
    modelAvgRtf: data.model_avg_rtf as number | undefined,
    modelSendFirstResponse: data.model_send_first_response as number | undefined,
    speechAdaptationVersion: data.speech_adaptation_version as string | undefined,
    modelTotalProcessTime: data.model_total_process_time as number | undefined,
    packetNumber: data.packet_number as number | undefined,
    vadStart: data.vad_start as boolean | undefined,
    reqPayload: data.req_payload as Record<string, unknown> | undefined
  }
}

// ─── 创建默认 ASRResponse ──────────────────────────────────────

export function createResponse(partial: Partial<ASRResponse>): ASRResponse {
  return {
    type: ResponseType.UNKNOWN,
    text: '',
    isFinal: false,
    vadStart: false,
    vadFinished: false,
    packetNumber: -1,
    errorMsg: '',
    results: [],
    ...partial
  }
}

// ─── 主解析函数 ──────────────────────────────────────────────

/**
 * 解析 ASR 响应（从 protobuf 二进制 → 结构化 ASRResponse）
 */
export function parseResponse(data: Buffer | Uint8Array): ASRResponse {
  const pb = fromBinary(AsrResponseSchema, data instanceof Uint8Array ? data : new Uint8Array(data))

  const { messageType, statusMessage, resultJson } = pb

  if (messageType === 'TaskStarted') {
    return createResponse({ type: ResponseType.TASK_STARTED })
  }

  if (messageType === 'SessionStarted') {
    return createResponse({ type: ResponseType.SESSION_STARTED })
  }

  if (messageType === 'SessionFinished') {
    return createResponse({ type: ResponseType.SESSION_FINISHED })
  }

  if (messageType === 'TaskFailed' || messageType === 'SessionFailed') {
    return createResponse({ type: ResponseType.ERROR, errorMsg: statusMessage })
  }

  if (!resultJson) {
    return createResponse({ type: ResponseType.UNKNOWN })
  }

  let jsonData: Record<string, unknown>
  try {
    jsonData = JSON.parse(resultJson) as Record<string, unknown>
  } catch {
    return createResponse({ type: ResponseType.UNKNOWN })
  }

  const resultsRaw = jsonData.results as Record<string, unknown>[] | undefined
  const extraRaw = (jsonData.extra as Record<string, unknown>) ?? {}
  const parsedExtra = parseExtra(extraRaw)

  // 无 results → 心跳包
  if (!resultsRaw) {
    return createResponse({
      type: ResponseType.HEARTBEAT,
      packetNumber: (extraRaw.packet_number as number) ?? -1,
      rawJson: jsonData,
      extra: parsedExtra
    })
  }

  const parsedResults = resultsRaw.map(parseResult)

  // VAD 开始
  if (extraRaw.vad_start) {
    return createResponse({
      type: ResponseType.VAD_START,
      vadStart: true,
      rawJson: jsonData,
      results: parsedResults,
      extra: parsedExtra
    })
  }

  // 解析识别结果
  let text = ''
  let isInterim = true
  let vadFinished = false
  let nonstreamResult = false

  for (const r of resultsRaw) {
    if (r.text) text = r.text as string
    if (r.is_interim === false) isInterim = false
    if (r.is_vad_finished) vadFinished = true
    const extra = r.extra as Record<string, unknown> | undefined
    if (extra?.nonstream_result) nonstreamResult = true
  }

  // 最终结果
  if (nonstreamResult || (!isInterim && vadFinished)) {
    return createResponse({
      type: ResponseType.FINAL_RESULT,
      text,
      isFinal: true,
      vadFinished,
      rawJson: jsonData,
      results: parsedResults,
      extra: parsedExtra
    })
  }

  // 中间结果
  return createResponse({
    type: ResponseType.INTERIM_RESULT,
    text,
    isFinal: false,
    rawJson: jsonData,
    results: parsedResults,
    extra: parsedExtra
  })
}
