#!/usr/bin/env node

/**
 * doubaoime-asr CLI
 *
 * 豆包输入法语音识别命令行工具
 */

import cac from 'cac'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { ASRConfig, type ASRConfigOptions } from './services/config.js'
import { DoubaoASR, ASRError } from './services/asr.js'
import { ner } from './services/ner.js'
import { ResponseType } from './types.js'

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
 * 加载 Opus 编码器（@discordjs/opus）
 */
async function loadOpusEncoder(
  sampleRate = 16000,
  channels = 1
): Promise<import('./types.js').OpusEncoder> {
  const opus = await import('@discordjs/opus')
  const encoder = new opus.OpusEncoder(sampleRate, channels)
  return {
    encode(pcm: Buffer, _frameSize: number): Buffer {
      return encoder.encode(pcm)
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
