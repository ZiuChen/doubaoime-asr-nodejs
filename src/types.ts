/**
 * 类型定义
 */

/** ASR 响应类型 */
export enum ResponseType {
  /** 任务已启动 */
  TASK_STARTED = 'TaskStarted',
  /** 会话已启动 */
  SESSION_STARTED = 'SessionStarted',
  /** 会话已结束 */
  SESSION_FINISHED = 'SessionFinished',
  /** 检测到语音开始 (VAD) */
  VAD_START = 'VadStart',
  /** 中间识别结果 */
  INTERIM_RESULT = 'InterimResult',
  /** 最终识别结果 */
  FINAL_RESULT = 'FinalResult',
  /** 心跳包 */
  HEARTBEAT = 'Heartbeat',
  /** 错误 */
  ERROR = 'Error',
  /** 未知 */
  UNKNOWN = 'Unknown'
}

/** 单词级别的识别结果 */
export interface ASRWord {
  word: string
  startTime: number
  endTime: number
}

/** OI 解码信息 */
export interface OIDecodingInfo {
  oiFormerWordNum: number
  oiLatterWordNum: number
  oiWords?: unknown[]
}

/** 识别候选结果 */
export interface ASRAlternative {
  text: string
  startTime: number
  endTime: number
  words: ASRWord[]
  semanticRelatedToPrev?: boolean
  oiDecodingInfo?: OIDecodingInfo
}

/** 单条识别结果 */
export interface ASRResult {
  text: string
  startTime: number
  endTime: number
  confidence: number
  alternatives: ASRAlternative[]
  isInterim: boolean
  isVadFinished: boolean
  index: number
}

/** 响应附加信息 */
export interface ASRExtra {
  audioDuration?: number
  modelAvgRtf?: number
  modelSendFirstResponse?: number
  speechAdaptationVersion?: string
  modelTotalProcessTime?: number
  packetNumber?: number
  vadStart?: boolean
  reqPayload?: Record<string, unknown>
}

/** ASR 响应 */
export interface ASRResponse {
  type: ResponseType
  text: string
  isFinal: boolean
  vadStart: boolean
  vadFinished: boolean
  packetNumber: number
  errorMsg: string
  rawJson?: Record<string, unknown>
  results: ASRResult[]
  extra?: ASRExtra
}

/** Opus 编码器接口 */
export interface OpusEncoder {
  /**
   * 将 PCM 数据编码为 Opus 帧
   * @param pcm 16-bit PCM 数据 Buffer
   * @param frameSize 每帧的采样数（如 16kHz/20ms = 320）
   * @returns 编码后的 Opus 帧
   */
  encode(pcm: Buffer, frameSize: number): Buffer
}

/** PCM 音频数据 */
export type AudioChunk = Buffer

/** 设备凭据 */
export interface DeviceCredentials {
  deviceId?: string
  installId?: string
  cdid?: string
  openudid?: string
  clientudid?: string
  token?: string
  samiToken?: string
  waveSession?: Record<string, unknown>
}

/** 会话配置 (发送给服务端) */
export interface SessionConfig {
  audio_info: {
    channel: number
    format: string
    sample_rate: number
  }
  enable_punctuation: boolean
  enable_speech_rejection: boolean
  extra: {
    app_name: string
    cell_compress_rate: number
    did: string
    enable_asr_threepass: boolean
    enable_asr_twopass: boolean
    input_mode: string
  }
}

/** NER 单词 */
export interface NerWord {
  freq: number
  word: string
}

/** NER 结果 */
export interface NerResult {
  text: string
  words: NerWord[]
}

/** NER 响应 */
export interface NerResponse {
  results: NerResult[]
}
