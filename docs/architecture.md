# Architecture / 架构文档

本文档介绍 `doubaoime-asr` 项目的整体架构设计，供首次参与开发的同学学习了解。

## 概述

本项目是对豆包输入法 Android 客户端 ASR（语音识别）协议的 Node.js 重写。通过逆向分析客户端通信协议，实现了设备注册、Token 获取、Wave 加密握手、WebSocket 语音识别、NER 等完整功能。

## 目录结构

```
doubaoime-asr-nodejs/
├── src/
│   ├── index.ts              # 公共 API 导出（库入口）
│   ├── cli.ts                # CLI 入口（命令行工具）
│   ├── constants.ts          # 常量：API URL、应用配置、设备配置
│   ├── types.ts              # TypeScript 类型定义
│   │
│   ├── gen/                  # 自动生成代码（不应手动编辑）
│   │   └── proto/
│   │       └── asr_pb.ts     # protobuf-es 生成的消息类型
│   │
│   ├── utils/                # 纯函数工具（无 I/O 副作用）
│   │   ├── audio.ts          # WAV 解析、PCM 处理、Opus 分帧
│   │   ├── crypto.ts         # 加密操作（ChaCha20、HKDF、ECDH、MD5 等）
│   │   ├── jwt.ts            # JWT 过期检查
│   │   └── response-parser.ts # ASR 响应 protobuf → 结构化对象
│   │
│   └── services/             # I/O 服务（网络请求、WebSocket、文件系统）
│       ├── asr.ts            # ASR WebSocket 客户端（核心）
│       ├── config.ts         # 配置管理 & 凭据缓存
│       ├── device.ts         # 设备注册 & Token 获取
│       ├── ner.ts            # 命名实体识别（NER）
│       ├── sami.ts           # SAMI Token 获取
│       └── wave-client.ts    # Wave 加密协议（ECDH + ChaCha20）
│
├── proto/
│   └── asr.proto             # Protobuf 消息定义
│
├── tests/
│   ├── utils/                # 工具函数测试
│   │   ├── audio.test.ts
│   │   ├── crypto.test.ts
│   │   ├── jwt.test.ts
│   │   ├── protobuf.test.ts
│   │   └── response-parser.test.ts
│   └── services/             # 服务测试
│       ├── asr.test.ts
│       └── config.test.ts
│
├── refs/
│   └── doubaoime-asr/        # Python 参考实现（git submodule）
│
├── examples/
│   ├── file-transcribe.ts    # 文件语音识别示例
│   ├── ner.ts                # NER 示例
│   └── credentials.ts        # 凭据管理示例
│
└── docs/
    ├── architecture.md       # 架构文档（本文件）
    └── getting-started.md    # 上手指南
```

## 分层架构

```
┌─────────────────────────────────────┐
│            CLI (cli.ts)             │  命令行入口
├─────────────────────────────────────┤
│         Public API (index.ts)       │  库的公共导出
├─────────────────────────────────────┤
│           Services 层               │  I/O 操作
│  ┌─────────┐ ┌──────┐ ┌──────────┐ │
│  │  asr.ts │ │ner.ts│ │device.ts │ │
│  └────┬────┘ └──┬───┘ └─────┬────┘ │
│       │         │            │      │
│  ┌────┴────┐ ┌──┴───────────┴────┐ │
│  │config.ts│ │  wave-client.ts   │ │
│  └─────────┘ └───────────────────┘ │
├─────────────────────────────────────┤
│            Utils 层                 │  纯函数
│  ┌───────┐ ┌────────┐ ┌─────────┐  │
│  │audio  │ │crypto  │ │response │  │
│  │.ts    │ │.ts     │ │-parser  │  │
│  └───────┘ └────────┘ └─────────┘  │
├─────────────────────────────────────┤
│    Constants / Types / Proto        │  基础层
└─────────────────────────────────────┘
```

### 设计原则

1. **纯函数抽取**：`utils/` 下的模块不进行任何 I/O 操作（无网络请求、无文件读写），方便单元测试
2. **服务层隔离**：`services/` 下的模块负责所有 I/O 操作（HTTP、WebSocket、文件系统）
3. **类型安全**：protobuf 消息使用 `protobuf-es` 生成的类型，ASR 响应有完整的 TypeScript 接口
4. **最小依赖**：加密、UUID、HTTP、文件系统全部使用 Node.js 原生 API

## 核心流程

### 1. 设备注册流程

```
Client                          Server
  │                                │
  │  POST /device_register/        │
  │  {magic_tag, header{cdid,...}} │
  │ ─────────────────────────────> │
  │                                │
  │  {device_id, install_id}       │
  │ <───────────────────────────── │
  │                                │
  │  POST /settings/v3/            │
  │  {body=null, x-ss-stub}       │
  │ ─────────────────────────────> │
  │                                │
  │  {asr_config: {app_key}}       │
  │ <───────────────────────────── │
```

- **device.ts** 模拟安卓客户端发送设备注册请求
- 生成随机 `cdid` (UUID)、`openudid`、`clientudid`
- 返回 `device_id` 后再请求 Settings API 获取 ASR `app_key`（即 Token）

### 2. Wave 加密握手

```
Client                          Server
  │                                │
  │  POST /handshake               │
  │  {version: 2,                  │
  │   random: <client_random>,     │
  │   key_shares: [{               │
  │     curve: "secp256r1",        │
  │     pubkey: <EC_public_key>    │
  │   }],                          │
  │   x-tt-s-sign: <ECDSA_sig>}   │
  │ ─────────────────────────────> │
  │                                │
  │  {random: <server_random>,     │
  │   key_share: {pubkey},         │
  │   ticket, ticket_exp, ...}     │
  │ <───────────────────────────── │
  │                                │
  │  ECDH shared_key = DH(priv, server_pub)
  │  encryption_key = HKDF(shared_key,
  │    salt=client_random||server_random,
  │    info="4e30514609050cd3")
```

- **wave-client.ts** 使用 P-256 (secp256r1) ECDH 密钥交换
- HKDF-SHA256 派生 32 字节 ChaCha20 加密密钥
- 后续 NER 等请求使用此密钥加密

### 3. ASR WebSocket 识别流程

```
Client                          Server
  │                                │
  │  ws://frontier-audio-ime-ws    │
  │  WebSocket Connect             │
  │ ─────────────────────────────> │
  │                                │
  │  StartTask (protobuf)          │
  │ ─────────────────────────────> │
  │  TaskStarted                   │
  │ <───────────────────────────── │
  │                                │
  │  StartSession (protobuf)       │
  │  {audio_info, enable_*}        │
  │ ─────────────────────────────> │
  │  SessionStarted                │
  │ <───────────────────────────── │
  │                                │
  │  TaskRequest (audio frames)    │
  │  [frame_state=FIRST]           │
  │ ─────────────────────────────> │
  │  InterimResult                 │
  │ <───────────────────────────── │
  │  ...                           │
  │  TaskRequest                   │
  │  [frame_state=LAST]            │
  │ ─────────────────────────────> │
  │  FinalResult                   │
  │ <───────────────────────────── │
  │                                │
  │  FinishSession (protobuf)      │
  │ ─────────────────────────────> │
  │  SessionFinished               │
  │ <───────────────────────────── │
```

- 使用 Protobuf 编码所有消息（`AsrRequest` / `AsrResponse`）
- 音频编码为 Opus 格式，按帧发送
- 支持三种模式：非流式、流式、实时流式

### 4. NER 流程

```
Client                          Server
  │                                │
  │  POST /get_config              │
  │  {sami_app_key}               │
  │ ─────────────────────────────> │
  │  {sami_token}                  │
  │ <───────────────────────────── │
  │                                │
  │  POST /ner (Wave encrypted)    │
  │  headers: {x-tt-e-b, ticket,  │
  │    nonce, x-api-token, ...}    │
  │  body: ChaCha20(request_json)  │
  │ ─────────────────────────────> │
  │                                │
  │  ChaCha20(response_json)       │
  │ <───────────────────────────── │
```

## Protobuf

消息定义在 `proto/asr.proto`，使用 `protobuf-es` (`@bufbuild/protobuf`) 生成 TypeScript 代码。

```protobuf
message AsrRequest {
  string token = 2;
  string service_name = 3;
  string method_name = 5;
  string payload = 6;
  bytes audio_data = 7;
  string request_id = 8;
  FrameState frame_state = 9;
}

message AsrResponse {
  string request_id = 1;
  string task_id = 2;
  string service_name = 3;
  string message_type = 4;
  int32 status_code = 5;
  string status_message = 6;
  string result_json = 7;
  int32 unknown_field_9 = 9;
}
```

重新生成：

```bash
protoc --es_out=src/gen --es_opt=target=ts \
  --plugin=protoc-gen-es=node_modules/.bin/protoc-gen-es \
  proto/asr.proto
```

## 加密方案

所有加密操作均使用 Node.js 原生 `crypto` 模块：

| 算法 | 用途 | Node.js API |
|---|---|---|
| P-256 ECDH | Wave 密钥交换 | `crypto.generateKeyPairSync('ec')` + `crypto.diffieHellman()` |
| HKDF-SHA256 | 密钥派生 | `crypto.hkdfSync()` |
| ChaCha20 | 数据加密 | `crypto.createCipheriv('chacha20')` |
| ECDSA-SHA256 | 握手签名 | `crypto.sign('sha256')` |
| MD5 | 请求校验 | `crypto.createHash('md5')` |

## 测试策略

- `tests/utils/` — 纯函数单元测试，覆盖 crypto、audio、jwt、protobuf、response-parser
- `tests/services/` — 服务层测试，验证配置管理和客户端初始化
- 使用 `vitest` 作为测试框架
- 不 mock 网络请求的集成测试需要真实服务器环境（不在 CI 中运行）

## 参考实现

Python 原始实现位于 `refs/doubaoime-asr`（git submodule），可作为协议细节的参考。
