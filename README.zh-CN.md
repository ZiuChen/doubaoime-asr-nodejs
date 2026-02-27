# doubaoime-asr

中文 | [English](README.md)

豆包输入法语音识别 Node.js 客户端。

基于 [doubaoime-asr (Python)](https://github.com/starccy/doubaoime-asr) 的 Node.js 重写，使用 Node.js >= 24 原生能力实现。

> **需要 Node.js >= 24**

## 免责声明

本项目通过对安卓豆包输入法客户端通信协议分析并参考客户端代码实现，**非官方提供的 API**。

- 本项目仅供学习和研究目的
- 不保证未来的可用性和稳定性
- 服务端协议可能随时变更导致功能失效

## 特性

- **语音识别** — 支持文件识别和实时流式 ASR
- **命名实体识别 (NER)** — 通过 Wave 加密 API 提取文本实体
- **设备注册** — 自动管理设备凭据
- **Wave 加密** — ECDH 密钥交换 + ChaCha20 流加密（完全基于原生 `crypto`）
- **Protobuf-es** — 类型安全的 protobuf 编解码（`@bufbuild/protobuf`）
- **CLI 工具** — 命令行快速转写
- **最小依赖** — 运行时仅 `ws`、`cac`、`@bufbuild/protobuf`、`@discordjs/opus`

## 安装

```bash
pnpm add doubaoime-asr
```

`@discordjs/opus`（原生 Opus 编码器）作为依赖一同分发，安装时会自动编译原生模块。

## 快速开始

### 作为库使用

```typescript
import { DoubaoASR, ASRConfig } from 'doubaoime-asr'
import { OpusEncoder } from '@discordjs/opus'

const opus = new OpusEncoder(16000, 1)
const config = new ASRConfig({
  credentialPath: './credentials.json', // 自动注册并缓存
  opusEncoder: { encode: (pcm) => opus.encode(pcm) },
})

const asr = new DoubaoASR(config)

// 简单识别
const text = await asr.transcribe('audio.wav')
console.log(text)

// 流式识别（含中间结果）
for await (const resp of asr.transcribeStream('audio.wav')) {
  console.log(resp.type, resp.text)
}

// 实时麦克风识别（需自行提供 PCM 音频源）
for await (const resp of asr.transcribeRealtime(audioSource)) {
  console.log(resp.type, resp.text)
}
```

#### 直接传入凭据对象

作为库使用时，可直接传入凭据对象而非文件路径：

```typescript
import { ASRConfig, registerDevice, getAsrToken } from 'doubaoime-asr'

// 程序化获取凭据
const creds = await registerDevice()
const token = await getAsrToken(creds.deviceId!, creds.cdid)

const config = new ASRConfig({
  credentials: { ...creds, token },
  opusEncoder: { encode: (pcm) => opus.encode(pcm) },
})
```

### CLI 使用

```bash
# 注册设备并保存凭据
doubaoime-asr register -o credentials.json

# 识别音频文件
doubaoime-asr transcribe audio.wav -c credentials.json

# 显示中间结果的详细输出
doubaoime-asr transcribe audio.wav -c credentials.json --verbose

# 命名实体识别
doubaoime-asr ner "明天北京天气怎么样" -c credentials.json

# 查看帮助
doubaoime-asr --help
```

### 环境变量

| 变量 | 说明 |
|---|---|
| `DOUBAO_CREDENTIAL_PATH` | 凭据文件路径 |
| `DOUBAO_DEVICE_ID` | 设备 ID（跳过注册） |
| `DOUBAO_TOKEN` | ASR Token（跳过获取） |

## API 参考

### `DoubaoASR`

核心客户端类。

| 方法 | 说明 |
|---|---|
| `transcribe(audio, options?)` | 识别音频文件或 PCM Buffer → 文本 |
| `transcribeStream(audio, options?)` | 流式识别 → `AsyncGenerator<ASRResponse>` |
| `transcribeRealtime(source)` | 实时流式识别（接收 `AsyncIterable<Buffer>`） |

### `ASRConfig`

配置类，带自动凭据管理。

| 参数 | 默认值 | 说明 |
|---|---|---|
| `credentialPath` | — | 凭据 JSON 文件路径 |
| `credentials` | — | `DeviceCredentials` 对象（优先级高于文件） |
| `deviceId` | — | 设备 ID（空则自动注册） |
| `token` | — | ASR Token（空则自动获取） |
| `opusEncoder` | — | Opus 编码器实例（**必须**） |
| `sampleRate` | `16000` | 采样率 (Hz) |
| `channels` | `1` | 声道数 |
| `frameDurationMs` | `20` | 帧时长 (ms) |
| `enablePunctuation` | `true` | 是否启用标点 |
| `connectTimeout` | `10000` | 连接超时 (ms) |
| `recvTimeout` | `10000` | 接收超时 (ms) |

### 便捷函数

```typescript
import { transcribe, transcribeStream, transcribeRealtime, ner } from 'doubaoime-asr'
```

### 其他导出

- `registerDevice()` — 手动注册设备
- `getAsrToken(deviceId)` — 手动获取 Token
- `getSamiToken(cdid?)` — 获取 SAMI Token（NER 服务用）
- `WaveClient` — Wave 加密协议客户端
- `parseWavFile(path)` / `parseWavBuffer(buf)` — WAV 解析工具
- `parseResponse(data)` — 解析 protobuf ASR 响应
- `isJwtExpired(token)` — JWT 过期检查
- `chacha20Crypt(key, nonce, data)` — ChaCha20 加解密
- `md5Hex(data)` — MD5 哈希（大写十六进制）

## 音频要求

- 格式：WAV (PCM, 16-bit)
- 采样率：16000 Hz（默认，可配置）
- 声道：单声道（默认，立体声自动转换）

```bash
ffmpeg -i input.mp3 -ar 16000 -ac 1 -f wav output.wav
```

## 原生能力

本项目最大化使用 Node.js 内置 API：

| 能力 | 实现方式 |
|---|---|
| HTTP 请求 | 原生 `fetch` |
| 加密（ECDH/HKDF/ChaCha20/ECDSA/MD5） | 原生 `crypto` |
| UUID 生成 | `crypto.randomUUID()` |
| WAV 文件解析 | 手动实现 |
| 文件系统 | 原生 `fs` |

运行时依赖：`ws`（WebSocket 自定义 Headers）、`cac`（CLI）、`@bufbuild/protobuf`（protobuf 编解码）、`@discordjs/opus`（Opus 音频编码）。

## 项目结构

详细架构文档请查看 [docs/architecture.md](docs/architecture.md)。

```
src/
├── index.ts              # 公共 API 导出
├── cli.ts                # CLI 入口 (cac)
├── constants.ts          # API URL、应用配置
├── types.ts              # TypeScript 类型定义
├── gen/proto/asr_pb.ts   # 生成的 protobuf 代码 (protobuf-es)
├── utils/                # 纯函数（无 I/O 副作用）
│   ├── audio.ts          # WAV 解析、PCM 处理
│   ├── crypto.ts         # 加密操作
│   ├── jwt.ts            # JWT 工具
│   └── response-parser.ts
└── services/             # I/O 服务（网络、文件系统）
    ├── asr.ts            # WebSocket ASR 客户端
    ├── config.ts         # 配置与凭据管理
    ├── device.ts         # 设备注册
    ├── ner.ts            # 命名实体识别
    ├── sami.ts           # SAMI Token 服务
    └── wave-client.ts    # Wave 加密协议
examples/
├── file-transcribe.ts    # 文件识别示例
├── ner.ts                # NER 示例
└── credentials.ts        # 凭据管理示例
```

## 示例

`examples/` 目录下提供可运行的示例脚本：

| 示例 | 说明 |
|---|---|
| `examples/file-transcribe.ts` | 文件语音识别（自动下载示例音频） |
| `examples/ner.ts` | 命名实体识别 |
| `examples/credentials.ts` | 三种凭据管理方式 |

```bash
npx tsx examples/file-transcribe.ts          # 使用示例音频
npx tsx examples/file-transcribe.ts my.wav   # 自定义文件
npx tsx examples/ner.ts "明天北京天气怎么样"
```

## 开发

```bash
pnpm install
pnpm test           # 运行测试
pnpm run typecheck  # 类型检查
pnpm run build      # 构建

# 重新生成 protobuf（需要 protoc + protoc-gen-es）
protoc --es_out=src/gen --es_opt=target=ts --plugin=protoc-gen-es=node_modules/.bin/protoc-gen-es proto/asr.proto
```

## 参考实现

Python 原始实现以 git submodule 形式维护在 `refs/doubaoime-asr` 目录下。

```bash
git submodule update --init
```

## 许可证

MIT
