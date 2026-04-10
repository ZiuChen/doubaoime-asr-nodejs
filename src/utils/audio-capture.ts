/**
 * 跨平台音频捕获模块
 *
 * 通过子进程调用系统录音工具（SoX / ffmpeg / arecord），
 * 将麦克风音频以 PCM 流的形式提供给 ASR 引擎。
 */

import { spawn, execSync, type ChildProcess } from 'node:child_process'
import { platform } from 'node:os'

export type RecorderBackend = 'sox' | 'ffmpeg' | 'arecord'

export interface AudioCaptureOptions {
  /** 音频输入设备名称 */
  device?: string
  /** 采样率，默认 16000 */
  sampleRate?: number
  /** 声道数，默认 1 */
  channels?: number
  /** 手动指定录音后端 */
  recorder?: RecorderBackend
}

// ─── 后端检测 ──────────────────────────────────────────────────

function isCommandAvailable(cmd: string): boolean {
  try {
    const which = platform() === 'win32' ? 'where' : 'which'
    execSync(`${which} ${cmd}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * 自动检测系统可用的录音后端
 * 优先级：sox → ffmpeg → arecord
 */
export function detectRecorder(): RecorderBackend {
  if (isCommandAvailable('sox')) return 'sox'
  if (isCommandAvailable('ffmpeg')) return 'ffmpeg'
  if (platform() === 'linux' && isCommandAvailable('arecord')) return 'arecord'

  const installHint =
    platform() === 'darwin'
      ? '请通过 Homebrew 安装: brew install sox'
      : platform() === 'win32'
        ? '请从 https://sox.sourceforge.net/ 下载安装 SoX，或安装 ffmpeg'
        : '请安装 sox (sudo apt install sox) 或 ffmpeg'

  throw new Error(`未检测到可用的录音工具 (sox / ffmpeg / arecord)。\n${installHint}`)
}

// ─── 设备列出 ──────────────────────────────────────────────────

function listDevicesSox(): string {
  // SoX 没有统一的设备列表命令，给出提示
  const os = platform()
  if (os === 'darwin') {
    return execSync('sox --help 2>&1 || true', { encoding: 'utf-8' }).toString()
  }
  return '(SoX 不直接支持列出设备，请使用系统工具查看可用音频设备)'
}

function listDevicesFfmpeg(): string {
  const os = platform()
  try {
    if (os === 'darwin') {
      return execSync('ffmpeg -f avfoundation -list_devices true -i "" 2>&1 || true', {
        encoding: 'utf-8'
      })
    } else if (os === 'linux') {
      // PulseAudio
      if (isCommandAvailable('pactl')) {
        return execSync('pactl list short sources 2>&1', { encoding: 'utf-8' })
      }
      return execSync('ffmpeg -sources pulse 2>&1 || true', { encoding: 'utf-8' })
    } else if (os === 'win32') {
      return execSync('ffmpeg -list_devices true -f dshow -i dummy 2>&1 || true', {
        encoding: 'utf-8'
      })
    }
  } catch {
    // ignore
  }
  return '(无法列出设备)'
}

function listDevicesArecord(): string {
  return execSync('arecord -l 2>&1', { encoding: 'utf-8' })
}

/**
 * 列出可用的音频输入设备
 */
export function listDevices(recorder?: RecorderBackend): string {
  const backend = recorder ?? detectRecorder()
  switch (backend) {
    case 'sox':
      return listDevicesSox()
    case 'ffmpeg':
      return listDevicesFfmpeg()
    case 'arecord':
      return listDevicesArecord()
  }
}

// ─── 构建录音命令 ──────────────────────────────────────────────

function buildSoxArgs(opts: Required<Pick<AudioCaptureOptions, 'sampleRate' | 'channels'>>): {
  cmd: string
  args: string[]
  env?: Record<string, string>
} {
  // rec 是 SoX 自带的录音快捷命令
  return {
    cmd: 'rec',
    args: [
      '-q', // 静默模式
      '-t',
      'raw', // 输出原始 PCM
      '-b',
      '16', // 16-bit
      '-e',
      'signed-integer',
      '-r',
      String(opts.sampleRate),
      '-c',
      String(opts.channels),
      '-' // 输出到 stdout
    ]
  }
}

function buildFfmpegArgs(
  opts: Required<Pick<AudioCaptureOptions, 'sampleRate' | 'channels'>> & { device?: string }
): { cmd: string; args: string[] } {
  const os = platform()
  const inputArgs: string[] = []

  if (os === 'darwin') {
    inputArgs.push('-f', 'avfoundation', '-i', `:${opts.device ?? '0'}`)
  } else if (os === 'linux') {
    inputArgs.push('-f', 'pulse', '-i', opts.device ?? 'default')
  } else if (os === 'win32') {
    const dev = opts.device ?? 'default'
    inputArgs.push('-f', 'dshow', '-i', `audio=${dev}`)
  }

  return {
    cmd: 'ffmpeg',
    args: [
      ...inputArgs,
      '-ar',
      String(opts.sampleRate),
      '-ac',
      String(opts.channels),
      '-f',
      's16le', // 16-bit signed little-endian PCM
      '-loglevel',
      'error',
      '-' // stdout
    ]
  }
}

function buildArecordArgs(
  opts: Required<Pick<AudioCaptureOptions, 'sampleRate' | 'channels'>> & { device?: string }
): { cmd: string; args: string[] } {
  const args = [
    '-f',
    'S16_LE',
    '-r',
    String(opts.sampleRate),
    '-c',
    String(opts.channels),
    '-t',
    'raw'
  ]

  if (opts.device) {
    args.unshift('-D', opts.device)
  }

  args.push('-') // stdout

  return { cmd: 'arecord', args }
}

// ─── 音频流创建 ──────────────────────────────────────────────

export interface AudioCapture {
  /** PCM 音频数据的异步迭代器 */
  stream: AsyncIterable<Buffer>
  /** 停止录音 */
  stop: () => void
  /** 录音子进程 */
  process: ChildProcess
}

/**
 * 创建实时音频捕获流
 *
 * @returns PCM 音频流 + 停止句柄
 */
export function createAudioCapture(options: AudioCaptureOptions = {}): AudioCapture {
  const sampleRate = options.sampleRate ?? 16000
  const channels = options.channels ?? 1
  const recorder = options.recorder ?? detectRecorder()

  let cmd: string
  let args: string[]
  let env: Record<string, string> | undefined

  switch (recorder) {
    case 'sox': {
      const sox = buildSoxArgs({ sampleRate, channels })
      cmd = sox.cmd
      args = sox.args
      // SoX 通过 AUDIODEV 环境变量指定设备
      if (options.device) {
        env = { ...(process.env as Record<string, string>), AUDIODEV: options.device }
      }
      break
    }
    case 'ffmpeg': {
      const ff = buildFfmpegArgs({ sampleRate, channels, device: options.device })
      cmd = ff.cmd
      args = ff.args
      break
    }
    case 'arecord': {
      const ar = buildArecordArgs({ sampleRate, channels, device: options.device })
      cmd = ar.cmd
      args = ar.args
      break
    }
  }

  const child = spawn(cmd, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    ...(env ? { env } : {})
  })

  let stopped = false

  const stream: AsyncIterable<Buffer> = {
    async *[Symbol.asyncIterator]() {
      for await (const chunk of child.stdout!) {
        if (stopped) return
        yield chunk as Buffer
      }
    }
  }

  const stop = () => {
    if (stopped) return
    stopped = true
    child.kill('SIGTERM')
  }

  // 收集 stderr 用于错误报告
  let stderrData = ''
  child.stderr?.on('data', (chunk: Buffer) => {
    stderrData += chunk.toString()
  })

  child.on('error', (err) => {
    if (!stopped) {
      const hint = err.message.includes('ENOENT')
        ? `录音工具 "${cmd}" 未找到，请确认已安装。`
        : err.message
      console.error(`录音进程错误: ${hint}`)
    }
  })

  child.on('exit', (code) => {
    if (!stopped && code && code !== 0) {
      console.error(`录音进程异常退出 (code=${code})${stderrData ? `:\n${stderrData}` : ''}`)
    }
  })

  return { stream, stop, process: child }
}
