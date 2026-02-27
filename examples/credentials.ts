/**
 * 凭据管理示例
 *
 * 演示三种凭据传入方式：
 * 1. 文件路径（credentialPath）
 * 2. 直接传入 JS 对象（credentials）
 * 3. 环境变量（DOUBAO_DEVICE_ID / DOUBAO_TOKEN）
 *
 * 用法：
 *   npx tsx examples/credentials.ts
 */

import { ASRConfig, registerDevice, getAsrToken } from '../src/index.js'
import type { DeviceCredentials } from '../src/index.js'

// ─── 方式 1: 文件路径 ──────────────────────────────────────────

async function demoFilePath() {
  console.log('='.repeat(50))
  console.log('方式 1: 通过文件路径管理凭据')
  console.log('='.repeat(50))

  const config = new ASRConfig({
    credentialPath: './credentials.json' // 自动注册、缓存、复用
  })

  await config.ensureCredentials()
  console.log(`设备 ID: ${config.deviceId}`)
  console.log(`Token:   ${config.token?.slice(0, 20)}...`)
  console.log()
}

// ─── 方式 2: 直接传入对象 ──────────────────────────────────────

async function demoDirectObject() {
  console.log('='.repeat(50))
  console.log('方式 2: 直接传入凭据对象')
  console.log('='.repeat(50))

  // 先注册设备获取凭据
  const creds: DeviceCredentials = await registerDevice()
  const token = await getAsrToken(creds.deviceId!, creds.cdid)

  // 直接传入凭据对象，无需文件系统
  const config = new ASRConfig({
    credentials: { ...creds, token }
  })

  await config.ensureCredentials()
  console.log(`设备 ID: ${config.deviceId}`)
  console.log(`Token:   ${config.token?.slice(0, 20)}...`)
  console.log()
}

// ─── 方式 3: 环境变量 ──────────────────────────────────────────

function demoEnvVars() {
  console.log('='.repeat(50))
  console.log('方式 3: 环境变量（CLI 场景）')
  console.log('='.repeat(50))
  console.log()
  console.log('CLI 支持以下环境变量：')
  console.log('  DOUBAO_CREDENTIAL_PATH  凭据文件路径')
  console.log('  DOUBAO_DEVICE_ID        设备 ID')
  console.log('  DOUBAO_TOKEN            ASR Token')
  console.log()
  console.log('内联使用示例：')
  console.log('  DOUBAO_DEVICE_ID=xxx DOUBAO_TOKEN=yyy doubaoime-asr transcribe audio.wav')
  console.log()
}

// ─── 主函数 ────────────────────────────────────────────────────

async function main() {
  await demoFilePath()
  await demoDirectObject()
  demoEnvVars()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
