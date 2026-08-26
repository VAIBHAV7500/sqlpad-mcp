import { describe, expect, it } from 'vitest'
import { loadConfig } from '../src/config.js'

const requiredEnv = {
  SQLPAD_BASE_URL: 'https://sqlpad.example.com',
  SQLPAD_SERVICE_TOKEN: 'service-secret',
}

describe('loadConfig', () => {
  it('loads required values and applies safe defaults', () => {
    expect(loadConfig([], requiredEnv)).toEqual({
      baseUrl: 'https://sqlpad.example.com',
      serviceToken: 'service-secret',
      allowWrites: false,
      allowAdmin: false,
      maxRows: 500,
      timeoutMs: 60_000,
      pollIntervalMs: 250,
    })
  })

  it('lets CLI values override environment values', () => {
    const config = loadConfig([
      '--base-url', 'https://cli.example.com/',
      '--token', 'cli-secret',
      '--max-rows', '12',
      '--timeout-ms=3456',
      '--allow-writes',
      '--allow-admin=true',
    ], {
      SQLPAD_BASE_URL: 'https://env.example.com',
      SQLPAD_SERVICE_TOKEN: 'env-secret',
      SQLPAD_MAX_ROWS: '999',
      SQLPAD_TIMEOUT_MS: '888',
      SQLPAD_ALLOW_WRITES: 'false',
      SQLPAD_ALLOW_ADMIN: 'false',
    })

    expect(config).toEqual({
      baseUrl: 'https://cli.example.com',
      serviceToken: 'cli-secret',
      allowWrites: true,
      allowAdmin: true,
      maxRows: 12,
      timeoutMs: 3456,
      pollIntervalMs: 250,
    })
  })

  it('coerces numeric and boolean environment values', () => {
    expect(loadConfig([], {
      ...requiredEnv,
      SQLPAD_MAX_ROWS: '25',
      SQLPAD_TIMEOUT_MS: '1200',
      SQLPAD_ALLOW_WRITES: 'TRUE',
      SQLPAD_ALLOW_ADMIN: 'false',
    })).toMatchObject({
      maxRows: 25,
      timeoutMs: 1200,
      allowWrites: true,
      allowAdmin: false,
    })
  })

  it.each([
    ['http://localhost:3000/', 'http://localhost:3000'],
    ['https://sqlpad.example.com///', 'https://sqlpad.example.com'],
    ['https://sqlpad.example.com/sqlpad///', 'https://sqlpad.example.com/sqlpad'],
  ])('removes every trailing slash from %s', (baseUrl, expected) => {
    expect(loadConfig([], { ...requiredEnv, SQLPAD_BASE_URL: baseUrl }).baseUrl).toBe(expected)
  })

  it.each(['ftp://sqlpad.example.com', 'not-a-url'])('rejects invalid base URL %s', (baseUrl) => {
    expect(() => loadConfig([], { ...requiredEnv, SQLPAD_BASE_URL: baseUrl }))
      .toThrow(/base URL.*http:\/\/ or https:\/\//i)
  })

  it('reports actionable missing base URL and token errors', () => {
    expect(() => loadConfig([], {})).toThrow(/Set SQLPAD_BASE_URL or pass --base-url/)
    expect(() => loadConfig([], { SQLPAD_BASE_URL: 'https://sqlpad.example.com' }))
      .toThrow(/Set SQLPAD_SERVICE_TOKEN or pass --token/)
    expect(() => loadConfig([], { ...requiredEnv, SQLPAD_SERVICE_TOKEN: '   ' }))
      .toThrow(/service token is invalid/i)
  })

  it('never includes the supplied token in a validation error', () => {
    const token = 'must-never-be-leaked'
    let message = ''

    try {
      loadConfig([], { ...requiredEnv, SQLPAD_SERVICE_TOKEN: token, SQLPAD_MAX_ROWS: 'invalid' })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).not.toContain(token)
    expect(message).toContain('max rows must be a positive integer')
  })

  it.each([
    ['SQLPAD_MAX_ROWS', '0'],
    ['SQLPAD_MAX_ROWS', '1.5'],
    ['SQLPAD_MAX_ROWS', 'invalid'],
    ['SQLPAD_TIMEOUT_MS', '-1'],
    ['SQLPAD_TIMEOUT_MS', '1.5'],
    ['SQLPAD_TIMEOUT_MS', 'invalid'],
  ])('rejects invalid numeric setting %s=%s', (name, value) => {
    expect(() => loadConfig([], { ...requiredEnv, [name]: value })).toThrow(/positive integer/)
  })

  it.each(['yes', '1', '', 'invalid'])('rejects invalid boolean environment value %j', (value) => {
    expect(() => loadConfig([], { ...requiredEnv, SQLPAD_ALLOW_WRITES: value }))
      .toThrow(/SQLPAD_ALLOW_WRITES must be true or false/)
  })

  it('rejects invalid numeric CLI values', () => {
    expect(() => loadConfig(['--max-rows', 'NaN'], requiredEnv)).toThrow(/positive integer/)
    expect(() => loadConfig(['--timeout-ms=0'], requiredEnv)).toThrow(/positive integer/)
  })

  it('rejects unsupported flags and missing flag values', () => {
    expect(() => loadConfig(['--unknown'], requiredEnv)).toThrow(/Unsupported command-line argument/)
    expect(() => loadConfig(['--token'], requiredEnv)).toThrow(/Missing value for --token/)
  })

  it('never echoes a token supplied as an unexpected positional argument', () => {
    const token = 'positional-token-must-not-leak'
    let message = ''

    try {
      loadConfig(['--allow-writes', token], {
        ...requiredEnv,
        SQLPAD_SERVICE_TOKEN: token,
      })
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }

    expect(message).toContain('Unsupported command-line argument')
    expect(message).not.toContain(token)
  })

  it('rejects false-like invalid values for CLI boolean flags', () => {
    expect(() => loadConfig(['--allow-admin=no'], requiredEnv)).toThrow(/SQLPAD_ALLOW_ADMIN must be true or false/)
  })

  it('allows an explicit CLI false value to override a true environment value', () => {
    expect(loadConfig(['--allow-writes=false'], {
      ...requiredEnv,
      SQLPAD_ALLOW_WRITES: 'true',
    }).allowWrites).toBe(false)
  })
})
