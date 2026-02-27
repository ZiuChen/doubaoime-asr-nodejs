/**
 * 音频工具
 *
 * WAV 文件解析、PCM 分帧、Opus 编码辅助
 */

import { readFileSync } from 'node:fs'
import type { OpusEncoder } from '../types.js'

// ─── WAV 文件解析 ──────────────────────────────────────────────

export interface WavInfo {
  /** 音频格式 (1 = PCM) */
  audioFormat: number
  /** 声道数 */
  channels: number
  /** 采样率 */
  sampleRate: number
  /** 每样本位数 */
  bitsPerSample: number
  /** PCM 数据 */
  data: Buffer
}

/**
 * 解析 WAV 文件，提取 PCM 数据
 *
 * 仅支持标准 PCM WAV (audioFormat=1, bitsPerSample=16)
 *
 * @param filePath WAV 文件路径
 * @returns WAV 信息及 PCM 数据
 */
export function parseWavFile(filePath: string): WavInfo {
  const buf = readFileSync(filePath)
  return parseWavBuffer(buf)
}

/**
 * 解析 WAV Buffer
 */
export function parseWavBuffer(buf: Buffer): WavInfo {
  // RIFF header
  const riff = buf.subarray(0, 4).toString('ascii')
  if (riff !== 'RIFF') throw new Error('Not a valid WAV file: missing RIFF header')

  const wave = buf.subarray(8, 12).toString('ascii')
  if (wave !== 'WAVE') throw new Error('Not a valid WAV file: missing WAVE format')

  let offset = 12
  let audioFormat = 0
  let channels = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let pcmData: Buffer | null = null

  // 遍历 chunks
  while (offset < buf.length) {
    const chunkId = buf.subarray(offset, offset + 4).toString('ascii')
    const chunkSize = buf.readUInt32LE(offset + 4)
    offset += 8

    if (chunkId === 'fmt ') {
      audioFormat = buf.readUInt16LE(offset)
      channels = buf.readUInt16LE(offset + 2)
      sampleRate = buf.readUInt32LE(offset + 4)
      // byteRate at offset + 8 (4 bytes)
      // blockAlign at offset + 12 (2 bytes)
      bitsPerSample = buf.readUInt16LE(offset + 14)
    } else if (chunkId === 'data') {
      pcmData = buf.subarray(offset, offset + chunkSize)
    }

    offset += chunkSize
    // WAV chunks are word-aligned
    if (chunkSize % 2 !== 0) offset += 1
  }

  if (!pcmData) throw new Error('WAV file has no data chunk')
  if (audioFormat !== 1)
    throw new Error(`Unsupported WAV format: ${audioFormat} (only PCM=1 supported)`)
  if (bitsPerSample !== 16)
    throw new Error(`Unsupported bits per sample: ${bitsPerSample} (only 16-bit supported)`)

  return { audioFormat, channels, sampleRate, bitsPerSample, data: pcmData }
}

// ─── PCM 处理 ──────────────────────────────────────────────────

/**
 * 将立体声 PCM 数据转换为单声道（16-bit）
 */
export function stereoToMono(pcmData: Buffer): Buffer {
  const sampleCount = pcmData.length / 4 // 2 channels * 2 bytes per sample
  const mono = Buffer.alloc(sampleCount * 2)

  for (let i = 0; i < sampleCount; i++) {
    const left = pcmData.readInt16LE(i * 4)
    const right = pcmData.readInt16LE(i * 4 + 2)
    mono.writeInt16LE(Math.round((left + right) / 2), i * 2)
  }

  return mono
}

/**
 * 从文件路径加载 PCM 数据
 *
 * @param filePath WAV 文件路径
 * @param targetSampleRate 目标采样率
 * @param targetChannels 目标声道数
 * @returns 16-bit PCM 数据 Buffer
 */
export function loadAudioFile(
  filePath: string,
  targetSampleRate = 16000,
  targetChannels = 1
): Buffer {
  const wav = parseWavFile(filePath)

  if (wav.sampleRate !== targetSampleRate) {
    throw new Error(
      `Sample rate mismatch: WAV is ${wav.sampleRate}Hz but expected ${targetSampleRate}Hz. ` +
        `Please convert your audio file first (e.g. ffmpeg -i input.wav -ar ${targetSampleRate} output.wav)`
    )
  }

  let pcm = wav.data

  if (wav.channels === 2 && targetChannels === 1) {
    pcm = stereoToMono(pcm)
  } else if (wav.channels !== targetChannels) {
    throw new Error(
      `Channel count mismatch: WAV has ${wav.channels} channels but expected ${targetChannels}. ` +
        `Please convert your audio file first.`
    )
  }

  return pcm
}

// ─── Opus 编码辅助 ──────────────────────────────────────────────

/**
 * 将 PCM 数据分帧并编码为 Opus
 *
 * @param pcmData 16-bit PCM 数据
 * @param encoder Opus 编码器
 * @param sampleRate 采样率
 * @param frameDurationMs 帧时长（毫秒）
 * @returns Opus 编码帧数组
 */
export function pcmToOpusFrames(
  pcmData: Buffer,
  encoder: OpusEncoder,
  sampleRate: number = 16000,
  frameDurationMs: number = 20
): Buffer[] {
  const samplesPerFrame = (sampleRate * frameDurationMs) / 1000
  const bytesPerFrame = samplesPerFrame * 2 // 16-bit

  const frames: Buffer[] = []

  for (let i = 0; i < pcmData.length; i += bytesPerFrame) {
    let chunk = pcmData.subarray(i, i + bytesPerFrame)

    // 不足一帧补零
    if (chunk.length < bytesPerFrame) {
      const padded = Buffer.alloc(bytesPerFrame)
      chunk.copy(padded)
      chunk = padded
    }

    frames.push(encoder.encode(chunk, samplesPerFrame))
  }

  return frames
}
