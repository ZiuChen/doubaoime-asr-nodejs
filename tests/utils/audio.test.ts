import { describe, expect, test } from 'vitest'
import { parseWavBuffer, stereoToMono, pcmToOpusFrames } from '../../src/utils/audio.js'
import type { OpusEncoder } from '../../src/types.js'

function createWavBuffer(
  sampleRate: number,
  channels: number,
  bitsPerSample: number,
  pcmData: Buffer
): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const blockAlign = channels * (bitsPerSample / 8)
  const dataSize = pcmData.length
  const fileSize = 36 + dataSize

  const buf = Buffer.alloc(44 + dataSize)
  let offset = 0

  // RIFF header
  buf.write('RIFF', offset)
  offset += 4
  buf.writeUInt32LE(fileSize, offset)
  offset += 4
  buf.write('WAVE', offset)
  offset += 4

  // fmt chunk
  buf.write('fmt ', offset)
  offset += 4
  buf.writeUInt32LE(16, offset)
  offset += 4 // chunk size
  buf.writeUInt16LE(1, offset)
  offset += 2 // PCM format
  buf.writeUInt16LE(channels, offset)
  offset += 2
  buf.writeUInt32LE(sampleRate, offset)
  offset += 4
  buf.writeUInt32LE(byteRate, offset)
  offset += 4
  buf.writeUInt16LE(blockAlign, offset)
  offset += 2
  buf.writeUInt16LE(bitsPerSample, offset)
  offset += 2

  // data chunk
  buf.write('data', offset)
  offset += 4
  buf.writeUInt32LE(dataSize, offset)
  offset += 4
  pcmData.copy(buf, offset)

  return buf
}

describe('audio', () => {
  test('parseWavBuffer: valid 16-bit mono PCM', () => {
    const pcm = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])
    const wav = createWavBuffer(16000, 1, 16, pcm)

    const info = parseWavBuffer(wav)
    expect(info.audioFormat).toBe(1)
    expect(info.channels).toBe(1)
    expect(info.sampleRate).toBe(16000)
    expect(info.bitsPerSample).toBe(16)
    expect(info.data).toEqual(pcm)
  })

  test('parseWavBuffer: rejects non-RIFF', () => {
    const buf = Buffer.from('NOT_RIFF_DATA_HERE...........')
    expect(() => parseWavBuffer(buf)).toThrow('RIFF')
  })

  test('parseWavBuffer: rejects non-PCM format', () => {
    const pcm = Buffer.from([0x00, 0x01])
    const wav = createWavBuffer(16000, 1, 16, pcm)
    wav.writeUInt16LE(3, 20) // float format
    expect(() => parseWavBuffer(wav)).toThrow('Unsupported WAV format')
  })

  test('stereoToMono', () => {
    const stereo = Buffer.alloc(8)
    stereo.writeInt16LE(100, 0)
    stereo.writeInt16LE(200, 2)
    stereo.writeInt16LE(-100, 4)
    stereo.writeInt16LE(100, 6)

    const mono = stereoToMono(stereo)
    expect(mono.length).toBe(4)
    expect(mono.readInt16LE(0)).toBe(150)
    expect(mono.readInt16LE(2)).toBe(0)
  })

  test('pcmToOpusFrames: splits correctly', () => {
    const mockEncoder: OpusEncoder = {
      encode(pcm: Buffer, _frameSize: number): Buffer {
        return Buffer.from([pcm.length])
      }
    }

    // 16kHz, 20ms = 320 samples = 640 bytes per frame
    const pcm = Buffer.alloc(640 * 3 + 100) // 3 full frames + partial
    const frames = pcmToOpusFrames(pcm, mockEncoder, 16000, 20)

    expect(frames.length).toBe(4) // 3 full + 1 padded partial
  })
})
