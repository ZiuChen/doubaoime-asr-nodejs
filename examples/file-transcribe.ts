/**
 * 音频文件语音识别示例
 *
 * 演示 transcribe 和 transcribeStream 的用法
 *
 * 用法：
 *   npx tsx examples/file-transcribe.ts [audio.wav]
 *
 * 如果不传入音频文件路径，将自动下载一个中文语音样本。
 */

import { writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { Encoder } from '@evan/opus'
import { DoubaoASR, ASRConfig, ResponseType } from '../dist/index.mjs'

// ─── 音频准备 ─────────────────────────────────────────────────

const SAMPLE_AUDIO_URL =
  'https://github.com/liangstein/Chinese-speech-to-text/raw/refs/heads/master/1.wav'

async function getAudioPath(): Promise<string> {
  const arg = process.argv[2]
  if (arg) return resolve(arg)

  const cachePath = resolve('examples/sample.wav')
  if (!existsSync(cachePath)) {
    console.log('正在下载示例音频...')
    const resp = await fetch(SAMPLE_AUDIO_URL)
    if (!resp.ok) throw new Error(`下载失败: ${resp.status}`)
    writeFileSync(cachePath, Buffer.from(await resp.arrayBuffer()))
    console.log(`已保存至 ${cachePath}`)
  }

  return cachePath
}

// ─── 非流式识别 ────────────────────────────────────────────────

async function demoTranscribe(asr: DoubaoASR, audioPath: string) {
  console.log('='.repeat(50))
  console.log('非流式识别 (transcribe)')
  console.log('='.repeat(50))

  const text = await asr.transcribe(audioPath)
  console.log(`识别结果: ${text}`)
  console.log()
}

// ─── 流式识别 ──────────────────────────────────────────────────

async function demoTranscribeStream(asr: DoubaoASR, audioPath: string) {
  console.log('='.repeat(50))
  console.log('流式识别 (transcribeStream)')
  console.log('='.repeat(50))

  for await (const resp of asr.transcribeStream(audioPath, { realtime: false })) {
    switch (resp.type) {
      case ResponseType.TASK_STARTED:
        console.log('[系统] 任务已启动')
        break
      case ResponseType.SESSION_STARTED:
        console.log('[系统] 会话已启动')
        break
      case ResponseType.VAD_START:
        console.log('[VAD] 检测到语音开始')
        break
      case ResponseType.INTERIM_RESULT:
        console.log(`[中间] ${resp.text}`)
        break
      case ResponseType.FINAL_RESULT: {
        const start = resp.results[0]?.startTime ?? 'N/A'
        const end = resp.results[0]?.endTime ?? 'N/A'
        console.log(`[最终] (${start} ~ ${end}) ${resp.text}`)
        break
      }
      case ResponseType.SESSION_FINISHED:
        console.log('[系统] 会话结束')
        break
      case ResponseType.ERROR:
        console.log(`[错误] ${resp.errorMsg}`)
        break
    }
  }
  console.log()
}

// ─── 主函数 ────────────────────────────────────────────────────

async function main() {
  const audioPath = await getAudioPath()

  const encoder = new Encoder({ sample_rate: 16000, channels: 1, application: 'voip' })

  const config = new ASRConfig({
    credentialPath: './credentials.json',
    opusEncoder: { encode: (pcm) => Buffer.from(encoder.encode(pcm)) }
  })

  const asr = new DoubaoASR(config)

  await demoTranscribe(asr, audioPath)
  await demoTranscribeStream(asr, audioPath)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
