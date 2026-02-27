/**
 * 命名实体识别 (NER) 示例
 *
 * 用法：
 *   npx tsx examples/ner.ts [文本]
 *
 * 默认识别："张三李四以及张三在使用 Chrome 浏览器"
 */

import { ASRConfig, ner } from '../src/index.js'

async function main() {
  const text = process.argv[2] ?? '张三李四以及张三在使用 Chrome 浏览器'

  const config = new ASRConfig({
    credentialPath: './credentials.json'
  })

  await config.ensureCredentials()

  console.log(`输入文本: ${text}`)
  console.log()

  const result = await ner(config, text)
  console.log('NER 结果:')
  console.log(JSON.stringify(result, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
