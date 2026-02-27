import { describe, expect, test } from 'vitest'
import { isJwtExpired } from '../../src/utils/jwt.js'

describe('jwt utils', () => {
  function makeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
    return `${header}.${body}.fake-signature`
  }

  test('returns false for non-expired token', () => {
    const futureExp = Math.floor(Date.now() / 1000) + 3600
    const token = makeJwt({ exp: futureExp })
    expect(isJwtExpired(token)).toBe(false)
  })

  test('returns true for expired token', () => {
    const pastExp = Math.floor(Date.now() / 1000) - 100
    const token = makeJwt({ exp: pastExp })
    expect(isJwtExpired(token)).toBe(true)
  })

  test('respects margin parameter', () => {
    // Token expires in 30 seconds
    const exp = Math.floor(Date.now() / 1000) + 30
    const token = makeJwt({ exp })

    // With default 60s margin, it's "expired"
    expect(isJwtExpired(token, 60)).toBe(true)

    // With 10s margin, it's still valid
    expect(isJwtExpired(token, 10)).toBe(false)
  })

  test('returns false for token without exp', () => {
    const token = makeJwt({ sub: 'user' })
    expect(isJwtExpired(token)).toBe(false)
  })

  test('returns false for invalid token', () => {
    expect(isJwtExpired('not-a-jwt')).toBe(false)
    expect(isJwtExpired('')).toBe(false)
  })
})
