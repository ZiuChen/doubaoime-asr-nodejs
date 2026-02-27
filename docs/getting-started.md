# Getting Started / 上手指南

本文档帮助你快速了解和参与 `doubaoime-asr` 项目的开发。

## 前置要求

- **Node.js >= 24**（使用了 `fetch`、`crypto` 等现代原生 API）
- **pnpm**（推荐的包管理器）
- **protoc**（仅在需要修改 `.proto` 文件时需要）

## 环境搭建

```bash
# 1. 克隆项目（含 submodule）
git clone --recurse-submodules <repo-url>
cd doubaoime-asr-nodejs

# 2. 安装依赖
pnpm install

# 3. 验证环境
pnpm run typecheck  # TypeScript 类型检查
pnpm test           # 运行测试
pnpm run build      # 构建
```

## 项目入门

### 理解协议

本项目逆向了豆包输入法的 ASR 通信协议。建议先阅读以下文件了解上下文：

1. **[architecture.md](architecture.md)** — 整体架构和核心流程图
2. **`refs/doubaoime-asr/`** — Python 参考实现（git submodule）
3. **`proto/asr.proto`** — Protobuf 消息定义

### 代码组织

代码分为三层，从下到上：

#### 基础层

- `src/constants.ts` — 所有硬编码的 URL、APP ID、设备配置等
- `src/types.ts` — 所有 TypeScript 接口和枚举
- `src/gen/proto/asr_pb.ts` — protobuf-es 生成的代码（**不要手动编辑**）

#### 工具层 (`src/utils/`)

纯函数，无副作用，易于测试：

- `crypto.ts` — 加密原语（ChaCha20、HKDF、ECDH、MD5 等）
- `audio.ts` — WAV 文件解析、PCM 声道转换、Opus 分帧
- `jwt.ts` — JWT 过期检查
- `response-parser.ts` — 将 protobuf 二进制 ASR 响应解析为结构化对象

#### 服务层 (`src/services/`)

涉及 I/O 操作的模块：

- `device.ts` — 设备注册（HTTP POST）
- `sami.ts` — SAMI Token 获取（HTTP POST）
- `wave-client.ts` — Wave 加密协议（ECDH 握手 + ChaCha20 加解密）
- `config.ts` — 配置管理（文件读写、凭据缓存）
- `asr.ts` — ASR 核心客户端（WebSocket 连接、音频流、响应处理）
- `ner.ts` — NER 接口调用（Wave 加密 HTTP）

### 入口文件

- `src/index.ts` — 库的公共 API 导出（给 npm 包消费者用）
- `src/cli.ts` — CLI 命令行工具入口（使用 `cac` 框架）

## 常见开发任务

### 添加新的 API 方法

1. 在 `src/types.ts` 中定义相关类型
2. 在 `src/services/` 下创建或修改服务模块
3. 在 `src/index.ts` 中导出新 API
4. 在 `tests/` 下添加对应测试

### 修改 Protobuf 定义

1. 编辑 `proto/asr.proto`
2. 重新生成代码：
   ```bash
   protoc --es_out=src/gen --es_opt=target=ts \
     --plugin=protoc-gen-es=node_modules/.bin/protoc-gen-es \
     proto/asr.proto
   ```
3. 更新相关的 service 代码

### 添加新的加密算法

1. 在 `src/utils/crypto.ts` 中添加纯函数
2. 在 `tests/utils/crypto.test.ts` 中添加测试
3. 在 service 中使用新函数

### 添加 CLI 命令

1. 编辑 `src/cli.ts`
2. 使用 `cac` 的 `.command()` API 注册新命令
3. 测试：`pnpm run build && node dist/cli.mjs <command>`

## 运行测试

```bash
# 运行所有测试
pnpm test

# 运行单个测试文件
pnpm vitest run tests/utils/crypto.test.ts

# 监听模式
pnpm vitest tests/utils/

# 查看覆盖率
pnpm vitest run --coverage
```

### 测试文件对应关系

| 源文件 | 测试文件 |
|---|---|
| `src/utils/audio.ts` | `tests/utils/audio.test.ts` |
| `src/utils/crypto.ts` | `tests/utils/crypto.test.ts` |
| `src/utils/jwt.ts` | `tests/utils/jwt.test.ts` |
| `src/utils/response-parser.ts` | `tests/utils/response-parser.test.ts` |
| `src/gen/proto/asr_pb.ts` | `tests/utils/protobuf.test.ts` |
| `src/services/config.ts` | `tests/services/config.test.ts` |
| `src/services/asr.ts` | `tests/services/asr.test.ts` |

## 构建 & 发布

```bash
# 构建（输出到 dist/）
pnpm run build

# 输出内容：
# dist/index.mjs     — 库入口
# dist/cli.mjs       — CLI 入口（带 shebang）
# dist/index.d.mts   — 类型声明

# 本地测试 CLI
node dist/cli.mjs --help
node dist/cli.mjs register -o test-creds.json
```

## 调试技巧

### 查看 WebSocket 通信

在 `src/services/asr.ts` 的 `receiveResponses` 方法中添加日志：

```typescript
const resp = parseResponse(buf)
console.log('[WS]', resp.type, resp.text?.slice(0, 50))
```

### 查看 Wave 加密请求

在 `src/services/wave-client.ts` 的 `prepareRequest` 方法中添加日志：

```typescript
console.log('[Wave] nonce:', nonce.toString('base64'))
console.log('[Wave] ticket:', this.session!.ticket.slice(0, 20) + '...')
```

### 验证 Protobuf 编码

```typescript
import { create, toBinary, fromBinary } from '@bufbuild/protobuf'
import { AsrRequestSchema, AsrResponseSchema } from './gen/proto/asr_pb.js'

const msg = create(AsrRequestSchema, { token: 'test', serviceName: 'ASR' })
const buf = toBinary(AsrRequestSchema, msg)
console.log('Encoded:', Buffer.from(buf).toString('hex'))
```

## 注意事项

1. **保持 utils 无副作用**：`src/utils/` 下的文件不应引入 `fs`、`fetch`、`WebSocket` 等 I/O 操作
2. **不要手动编辑 gen/ 目录**：`src/gen/` 下的代码由 protoc 生成，修改会被覆盖
3. **Node.js 版本**：本项目硬性要求 >= 24，使用了 `crypto.hkdfSync`、`fetch` 等 API
4. **Opus 编码器**：`@discordjs/opus` 作为 dependencies 分发，安装时会自动编译原生模块
