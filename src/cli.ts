#!/usr/bin/env node

/**
 * doubaoime-asr CLI
 *
 * 豆包输入法语音识别命令行工具
 */

import cac from 'cac'
import { readFileSync, createWriteStream, type WriteStream } from 'node:fs'
import { resolve } from 'node:path'

import { ASRConfig, type ASRConfigOptions } from './services/config.js'
import { DoubaoASR, ASRError } from './services/asr.js'
import { ner } from './services/ner.js'
import { ResponseType } from './types.js'
import {
  createAudioCapture,
  detectRecorder,
  listDevices,
  type RecorderBackend
} from './utils/audio-capture.js'

const { version } = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf-8')
) as { version: string }

// ─── 环境变量 ─────────────────────────────────────────────────

function resolveConfigOptions(opts: {
  credentialPath?: string
  deviceId?: string
  token?: string
  sampleRate?: number
  channels?: number
  frameDuration?: number
  appName?: string
}): ASRConfigOptions {
  return {
    credentialPath: opts.credentialPath ?? process.env.DOUBAO_CREDENTIAL_PATH,
    deviceId: opts.deviceId ?? process.env.DOUBAO_DEVICE_ID,
    token: opts.token ?? process.env.DOUBAO_TOKEN,
    sampleRate: opts.sampleRate,
    channels: opts.channels,
    frameDurationMs: opts.frameDuration,
    appName: opts.appName
  }
}

/**
 * 加载 Opus 编码器（@evan/opus）
 */
async function loadOpusEncoder(
  sampleRate = 16000,
  channels = 1
): Promise<import('./types.js').OpusEncoder> {
  const { Encoder } = await import('@evan/opus')
  const encoder = new Encoder({
    sample_rate: sampleRate as 16000,
    channels: channels as 1,
    application: 'voip'
  })
  return {
    encode(pcm: Buffer, _frameSize: number): Buffer {
      return Buffer.from(encoder.encode(pcm))
    }
  }
}

// ─── CLI ─────────────────────────────────────────────────────

const cli = cac('doubaoime-asr')

// 全局选项
cli
  .option('-c, --credential-path <path>', '凭据文件路径 (env: DOUBAO_CREDENTIAL_PATH)')
  .option('--device-id <id>', '设备 ID (env: DOUBAO_DEVICE_ID)')
  .option('--token <token>', 'ASR Token (env: DOUBAO_TOKEN)')

// transcribe
cli
  .command('transcribe <file>', '语音识别：将音频文件转为文字')
  .option('--sample-rate <rate>', '采样率 (默认: 16000)', { default: 16000 })
  .option('--channels <n>', '声道数 (默认: 1)', { default: 1 })
  .option('--frame-duration <ms>', '帧时长 ms (默认: 20)', { default: 20 })
  .option('--realtime', '按实时速度发送音频帧')
  .option('--app-name <name>', '应用名称')
  .option('--verbose', '显示中间结果')
  .example('doubaoime-asr transcribe audio.wav')
  .example('doubaoime-asr transcribe audio.wav --realtime --verbose')
  .action(async (file: string, opts: Record<string, unknown>) => {
    try {
      const configOptions = resolveConfigOptions(opts as never)
      const config = new ASRConfig(configOptions)

      const encoder = await loadOpusEncoder(config.sampleRate, config.channels)
      config.opusEncoder = encoder

      const asr = new DoubaoASR(config)
      const filePath = resolve(file)

      if (opts.verbose) {
        for await (const resp of asr.transcribeStream(filePath, { realtime: !!opts.realtime })) {
          switch (resp.type) {
            case ResponseType.TASK_STARTED:
              console.error('[任务已启动]')
              break
            case ResponseType.SESSION_STARTED:
              console.error('[会话已启动]')
              break
            case ResponseType.INTERIM_RESULT:
              console.error(`[中间结果] ${resp.text}`)
              break
            case ResponseType.FINAL_RESULT:
              console.log(resp.text)
              break
            case ResponseType.SESSION_FINISHED:
              console.error('[会话已结束]')
              break
            case ResponseType.ERROR:
              console.error(`[错误] ${resp.errorMsg}`)
              process.exit(1)
              break
          }
        }
      } else {
        const text = await asr.transcribe(filePath, { realtime: !!opts.realtime })
        console.log(text)
      }
    } catch (err) {
      if (err instanceof ASRError) {
        console.error(`ASR 错误: ${err.message}`)
      } else {
        console.error(`错误: ${(err as Error).message}`)
      }
      process.exit(1)
    }
  })

// ner
cli
  .command('ner <text>', '命名实体识别')
  .option('--app-name <name>', '应用名称')
  .example('doubaoime-asr ner "明天北京天气怎么样"')
  .action(async (text: string, opts: Record<string, unknown>) => {
    try {
      const configOptions = resolveConfigOptions(opts as never)
      const config = new ASRConfig(configOptions)
      await config.ensureCredentials()

      const result = await ner(config, text, (opts.appName as string) ?? '')
      console.log(JSON.stringify(result, null, 2))
    } catch (err) {
      console.error(`错误: ${(err as Error).message}`)
      process.exit(1)
    }
  })

// listen
cli
  .command('listen', '实时语音识别：从麦克风采集音频并实时转文字')
  .option('--device <name>', '音频输入设备名称')
  .option('--output [path]', '识别文本输出文件路径 (默认自动生成，--no-output 禁用)')
  .option('--sample-rate <rate>', '采样率 (默认: 16000)', { default: 16000 })
  .option('--channels <n>', '声道数 (默认: 1)', { default: 1 })
  .option('--frame-duration <ms>', '帧时长 ms (默认: 20)', { default: 20 })
  .option('--app-name <name>', '应用名称')
  .option('--verbose', '显示中间结果')
  .option('--recorder <type>', '录音后端: sox | ffmpeg | arecord (默认自动检测)')
  .option('--list-devices', '列出可用音频设备并退出')
  .example('doubaoime-asr listen')
  .example('doubaoime-asr listen --output result.txt --verbose')
  .example('doubaoime-asr listen --no-output')
  .example('doubaoime-asr listen --device "MacBook Pro Microphone" --recorder sox')
  .example('doubaoime-asr listen --list-devices')
  .action(async (opts: Record<string, unknown>) => {
    try {
      // 列出设备
      if (opts.listDevices) {
        const output = listDevices(opts.recorder as RecorderBackend | undefined)
        console.log(output)
        return
      }

      const configOptions = resolveConfigOptions(opts as never)
      const config = new ASRConfig(configOptions)

      const encoder = await loadOpusEncoder(config.sampleRate, config.channels)
      config.opusEncoder = encoder

      const asr = new DoubaoASR(config)

      // 检测录音后端
      const recorder = (opts.recorder as RecorderBackend | undefined) ?? detectRecorder()
      console.error(`[录音后端] ${recorder}`)

      const captureOptions = {
        device: opts.device as string | undefined,
        sampleRate: config.sampleRate,
        channels: config.channels,
        recorder
      }

      // 输出文件
      // --no-output → opts.output === false
      // --output path.txt → opts.output === 'path.txt'
      // --output (无值) 或未传 → opts.output === true 或 undefined → 自动生成
      let fileStream: WriteStream | undefined
      if (opts.output !== false) {
        const outputPath =
          typeof opts.output === 'string'
            ? opts.output
            : `transcript_${new Date().toISOString().replace(/[:.]/g, '').replace('T', '_').slice(0, 15)}.txt`
        try {
          fileStream = createWriteStream(resolve(outputPath), { flags: 'a', encoding: 'utf-8' })
          console.error(`[输出文件] ${resolve(outputPath)}`)
        } catch {
          console.error(`[警告] 无法创建输出文件: ${resolve(outputPath)}，仅终端输出`)
        }
      }

      console.error('[开始录音] 按 Ctrl+C 停止...\n')

      // SIGINT 优雅退出
      let stopping = false
      let currentCapture = createAudioCapture(captureOptions)
      process.on('SIGINT', () => {
        if (stopping) return
        stopping = true
        console.error('\n[停止录音...]')
        currentCapture.stop()
      })

      // 实时识别（服务端偶尔返回 InternalError / ExceededConcurrentQuota，自动重试）
      const MAX_RETRIES = 3
      const RETRY_DELAY_MS = 3000
      let retries = 0

      while (retries <= MAX_RETRIES) {
        let gotError = false

        try {
          for await (const resp of asr.transcribeRealtime(currentCapture.stream)) {
            switch (resp.type) {
              case ResponseType.TASK_STARTED:
                if (opts.verbose) console.error('[任务已启动]')
                break
              case ResponseType.SESSION_STARTED:
                if (opts.verbose) console.error('[会话已启动]')
                retries = 0
                break
              case ResponseType.VAD_START:
                if (opts.verbose) console.error('[检测到语音]')
                break
              case ResponseType.INTERIM_RESULT:
                if (opts.verbose) process.stderr.write(`\r[识别中] ${resp.text}`)
                break
              case ResponseType.FINAL_RESULT:
                if (opts.verbose) process.stderr.write('\r' + ' '.repeat(80) + '\r')
                console.log(resp.text)
                if (fileStream) {
                  fileStream.write(resp.text + '\n')
                }
                break
              case ResponseType.SESSION_FINISHED:
                if (opts.verbose) console.error('[会话已结束]')
                break
              case ResponseType.ERROR:
                if (
                  (resp.errorMsg === 'InternalError' ||
                    resp.errorMsg === 'ExceededConcurrentQuota') &&
                  retries < MAX_RETRIES &&
                  !stopping
                ) {
                  retries++
                  console.error(
                    `[服务端错误: ${resp.errorMsg}，${RETRY_DELAY_MS / 1000}s 后重试 (${retries}/${MAX_RETRIES})...]`
                  )
                  gotError = true
                } else {
                  console.error(`[错误] ${resp.errorMsg}`)
                  currentCapture.stop()
                }
                break
            }
          }
        } catch (err) {
          // initializeSession 抛出的异常也可重试
          const msg = (err as Error).message ?? ''
          if (
            (msg.includes('InternalError') || msg.includes('ExceededConcurrentQuota')) &&
            retries < MAX_RETRIES &&
            !stopping
          ) {
            retries++
            console.error(
              `[服务端错误: ${msg}，${RETRY_DELAY_MS / 1000}s 后重试 (${retries}/${MAX_RETRIES})...]`
            )
            gotError = true
          } else {
            throw err
          }
        }

        if (!gotError || stopping) break

        // 重试前重建音频捕获（旧的流已不可用）
        currentCapture.stop()
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS))
        currentCapture = createAudioCapture(captureOptions)
      }

      // 关闭文件流
      if (fileStream) {
        await new Promise<void>((resolve) => fileStream!.end(resolve))
        console.error('[文件已保存]')
      }
    } catch (err) {
      if (err instanceof ASRError) {
        console.error(`ASR 错误: ${err.message}`)
      } else {
        console.error(`错误: ${(err as Error).message}`)
      }
      process.exit(1)
    }
  })

// register
cli
  .command('register', '注册设备并获取凭据')
  .option('-o, --output <path>', '凭据输出路径')
  .example('doubaoime-asr register -o credentials.json')
  .action(async (opts: Record<string, unknown>) => {
    try {
      const outputPath =
        (opts.output as string) ??
        (opts.credentialPath as string) ??
        process.env.DOUBAO_CREDENTIAL_PATH

      const config = new ASRConfig({
        credentialPath: outputPath as string | undefined
      })
      await config.ensureCredentials()

      if (outputPath) {
        console.log(`凭据已保存至: ${outputPath}`)
      }
      console.log(`设备 ID: ${config.deviceId}`)
      console.log(`Token: ${config.token}`)
    } catch (err) {
      console.error(`错误: ${(err as Error).message}`)
      process.exit(1)
    }
  })

// 版本 & 帮助
cli.version(version)
cli.help()

// 无子命令时显示帮助
cli.on('command:*', () => {
  console.error('未知命令: %s\n', cli.args.join(' '))
  cli.outputHelp()
  process.exit(1)
})

// 解析
cli.parse()

// 无参数时显示帮助
if (cli.matchedCommand == null && cli.args.length === 0) {
  cli.outputHelp()
}
