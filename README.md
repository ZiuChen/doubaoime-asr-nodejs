# @ziuchen/doubaoime-asr

[中文](README.zh-CN.md) | English

Node.js client for **Doubao IME** (豆包输入法) Automatic Speech Recognition (ASR) service.

Node.js rewrite based on [doubaoime-asr (Python)](https://github.com/starccy/doubaoime-asr), implemented using Node.js >= 24 native capabilities.

> **Requires Node.js >= 24**

## Disclaimer

This project is based on protocol analysis and reference to the Android Doubao IME client. **It is NOT an official API.**

- For learning and research purposes only
- No guarantee of future availability or stability
- Server-side protocols may change at any time

## Features

- **Speech Recognition** — File-based and real-time streaming ASR
- **Named Entity Recognition (NER)** — Extract entities from text via Wave-encrypted API
- **Device Registration** — Automatic device credential management
- **Wave Encryption** — ECDH key exchange + ChaCha20 stream cipher (fully native `crypto`)
- **Protobuf-es** — Type-safe message encoding/decoding via `@bufbuild/protobuf`
- **CLI Tool** — Command-line interface for quick transcription
- **Minimal Dependencies** — Only `ws`, `cac`, `@bufbuild/protobuf`, and `@evan/opus` at runtime

## Installation

```bash
pnpm add @ziuchen/doubaoime-asr
```

After installation, you can use the CLI globally via the `doubaoime-asr` command, or directly via npx:

```
npx @ziuchen/doubaoime-asr transcribe audio.wav -c credentials.json
```

## Quick Start

### Library Usage

```typescript
import { DoubaoASR, ASRConfig } from '@ziuchen/doubaoime-asr'
import { Encoder } from '@evan/opus'

const encoder = new Encoder({ sample_rate: 16000, channels: 1, application: 'voip' })
const config = new ASRConfig({
  credentialPath: './credentials.json', // Auto-register and cache
  opusEncoder: { encode: (pcm) => Buffer.from(encoder.encode(pcm)) },
})

const asr = new DoubaoASR(config)

// Simple transcription
const text = await asr.transcribe('audio.wav')
console.log(text)

// Streaming with interim results
for await (const resp of asr.transcribeStream('audio.wav')) {
  console.log(resp.type, resp.text)
}

// Real-time from microphone (provide your own PCM source)
for await (const resp of asr.transcribeRealtime(audioSource)) {
  console.log(resp.type, resp.text)
}
```

#### Passing Credentials as Object

When used as a library, you can pass credentials directly as a JS object instead of a file path:

```typescript
import { ASRConfig, registerDevice, getAsrToken } from '@ziuchen/doubaoime-asr'
import { Encoder } from '@evan/opus'

// Obtain credentials programmatically
const creds = await registerDevice()
const token = await getAsrToken(creds.deviceId!, creds.cdid)

const encoder = new Encoder({ sample_rate: 16000, channels: 1, application: 'voip' })
const config = new ASRConfig({
  credentials: { ...creds, token },
  opusEncoder: { encode: (pcm) => Buffer.from(encoder.encode(pcm)) },
})
```

### CLI Usage

```bash
# Register device & save credentials
doubaoime-asr register -o credentials.json

# Transcribe audio file
doubaoime-asr transcribe audio.wav -c credentials.json

# Named Entity Recognition
doubaoime-asr ner "明天北京天气怎么样" -c credentials.json

# Real-time recognition (from microphone)
doubaoime-asr listen --list-devices

# Help
doubaoime-asr --help
```

### Environment Variables

| Variable | Description |
|---|---|
| `DOUBAO_CREDENTIAL_PATH` | Credential file path |
| `DOUBAO_DEVICE_ID` | Device ID (skip registration) |
| `DOUBAO_TOKEN` | ASR token (skip token fetch) |

## API Reference

### `DoubaoASR`

Main client class.

| Method | Description |
|---|---|
| `transcribe(audio, options?)` | Transcribe audio file or PCM buffer → text |
| `transcribeStream(audio, options?)` | Streaming transcription → `AsyncGenerator<ASRResponse>` |
| `transcribeRealtime(source)` | Real-time streaming from `AsyncIterable<Buffer>` |

### `ASRConfig`

Configuration class with automatic credential management.

| Option | Default | Description |
|---|---|---|
| `credentialPath` | — | Path to credential JSON file |
| `credentials` | — | `DeviceCredentials` object (takes precedence over file) |
| `deviceId` | — | Device ID (auto-register if empty) |
| `token` | — | ASR token (auto-fetch if empty) |
| `opusEncoder` | — | Opus encoder instance (**required**) |
| `sampleRate` | `16000` | Audio sample rate (Hz) |
| `channels` | `1` | Audio channels |
| `frameDurationMs` | `20` | Frame duration (ms) |
| `enablePunctuation` | `true` | Enable punctuation |
| `connectTimeout` | `10000` | Connection timeout (ms) |
| `recvTimeout` | `10000` | Receive timeout (ms) |

### Convenience Functions

```typescript
import { transcribe, transcribeStream, transcribeRealtime, ner } from '@ziuchen/doubaoime-asr'
```

### Other Exports

- `registerDevice()` — Manual device registration
- `getAsrToken(deviceId)` — Manual token retrieval
- `getSamiToken(cdid?)` — SAMI token for NER service
- `WaveClient` — Wave encryption protocol client
- `parseWavFile(path)` / `parseWavBuffer(buf)` — WAV parsing utilities
- `parseResponse(data)` — Parse protobuf ASR response
- `isJwtExpired(token)` — JWT expiry check
- `chacha20Crypt(key, nonce, data)` — ChaCha20 encrypt/decrypt
- `md5Hex(data)` — MD5 hash (uppercase hex)

## Audio Requirements

- Format: WAV (PCM, 16-bit)
- Sample rate: 16000 Hz (default, configurable)
- Channels: Mono (default, stereo auto-converted)

```bash
ffmpeg -i input.mp3 -ar 16000 -ac 1 -f wav output.wav
```

## Native Capabilities

This project maximizes use of Node.js built-in APIs:

| Capability | Implementation |
|---|---|
| HTTP requests | Native `fetch` |
| Crypto (ECDH/HKDF/ChaCha20/ECDSA/MD5) | Native `crypto` |
| UUID generation | `crypto.randomUUID()` |
| WAV parsing | Manual implementation |
| File system | Native `fs` |

Runtime dependencies: `ws` (WebSocket with custom headers), `cac` (CLI), `@bufbuild/protobuf` (protobuf encoding), `@evan/opus` (Opus audio encoding, Wasm).

## Examples

See the `examples/` directory for runnable scripts:

| Example | Description |
|---|---|
| `examples/file-transcribe.ts` | File-based transcription (auto-downloads sample audio) |
| `examples/ner.ts` | Named Entity Recognition |
| `examples/credentials.ts` | Three ways to manage credentials |

```bash
npx tsx examples/file-transcribe.ts          # uses sample audio
npx tsx examples/file-transcribe.ts my.wav   # custom file
npx tsx examples/ner.ts "明天北京天气怎么样"
```

## Development

```bash
pnpm install
pnpm test           # Run tests
pnpm run typecheck  # Type check
pnpm run build      # Build

# Regenerate protobuf (requires protoc + protoc-gen-es)
protoc --es_out=src/gen --es_opt=target=ts --plugin=protoc-gen-es=node_modules/.bin/protoc-gen-es proto/asr.proto
```

## Reference Implementation

The Python reference implementation is maintained as a git submodule under the `refs/@ziuchen/doubaoime-asr` directory.

```bash
git submodule update --init
```

## License

MIT
