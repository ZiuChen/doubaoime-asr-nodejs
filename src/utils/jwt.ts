/**
 * JWT 工具函数
 */

/**
 * 检查 JWT token 是否已过期（提前 margin 秒视为过期）
 */
export function isJwtExpired(token: string, margin = 60): boolean {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return false

    let payload = parts[1]!
    // JWT base64url 需要补齐 padding
    const pad = 4 - (payload.length % 4)
    if (pad !== 4) payload += '='.repeat(pad)

    const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number }
    if (decoded.exp == null) return false
    return Date.now() / 1000 >= decoded.exp - margin
  } catch {
    return false
  }
}
