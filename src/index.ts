/**
 * doubaoime-asr
 *
 * 豆包输入法语音识别 Node.js 客户端
 */

// 核心客户端
export {
  DoubaoASR,
  ASRError,
  transcribe,
  transcribeStream,
  transcribeRealtime
} from './services/asr.js'
export type { TranscribeOptions } from './services/asr.js'

// 配置
export { ASRConfig } from './services/config.js'
export type { ASRConfigOptions } from './services/config.js'

// 类型
export { ResponseType } from './types.js'
export { FrameState } from './gen/proto/asr_pb.js'
export type {
  ASRResponse,
  ASRResult,
  ASRAlternative,
  ASRWord,
  ASRExtra,
  OIDecodingInfo,
  AudioChunk,
  OpusEncoder,
  SessionConfig,
  DeviceCredentials,
  NerResponse,
  NerResult,
  NerWord
} from './types.js'

// NER
export { ner } from './services/ner.js'

// 音频工具
export {
  parseWavFile,
  parseWavBuffer,
  loadAudioFile,
  pcmToOpusFrames,
  stereoToMono
} from './utils/audio.js'
export type { WavInfo } from './utils/audio.js'

// Wave 加密客户端
export { WaveClient } from './services/wave-client.js'
export type { WaveSession } from './services/wave-client.js'

// 设备注册
export { registerDevice, getAsrToken } from './services/device.js'

// SAMI
export { getSamiToken } from './services/sami.js'

// 加密工具
export { chacha20Crypt, deriveKey, md5Hex } from './utils/crypto.js'

// JWT 工具
export { isJwtExpired } from './utils/jwt.js'

// 响应解析
export { parseResponse } from './utils/response-parser.js'
