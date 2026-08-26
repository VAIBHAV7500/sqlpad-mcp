import { describe, expect, it, vi } from 'vitest'
import { SqlPadClient } from '../src/client/SqlPadClient.js'
import { SqlPadError } from '../src/client/errors.js'
import type { SqlPadConfig } from '../src/config.js'

const serviceToken = 'test-service-token'

function config(baseUrl = 'https://sqlpad.example.com'): SqlPadConfig {
  return {
    baseUrl,
    serviceToken,
    allowWrites: false,
    allowAdmin: false,
    maxRows: 500,
    timeoutMs: 60_000,
    pollIntervalMs: 250,
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fetchMock(...responses: Array<Response | Error>): ReturnType<typeof vi.fn> {
  const mock = vi.fn()
  for (const response of responses) {
    if (response instanceof Error) mock.mockRejectedValueOnce(response)
    else mock.mockResolvedValueOnce(response)
  }
  return mock
}

function asFetch(mock: ReturnType<typeof vi.fn>): typeof fetch {
  return mock as unknown as typeof fetch
}

async function caught(promise: Promise<unknown>): Promise<SqlPadError> {
  try {
    await promise
  } catch (error) {
    expect(error).toBeInstanceOf(SqlPadError)
    return error as SqlPadError
  }
  throw new Error('Expected the request to reject')
}

describe('SqlPadClient URL construction', () => {
  it('joins an API path onto a root base URL', async () => {
    const mock = fetchMock(jsonResponse({ version: '7.5.0', config: {} }))
    const client = new SqlPadClient(config('https://sqlpad.example.com'), asFetch(mock))

    await client.getAppInfo()

    expect(mock).toHaveBeenCalledTimes(1)
    expect(String(mock.mock.calls[0]?.[0])).toBe('https://sqlpad.example.com/api/app')
  })

  it('preserves a base URL subpath', async () => {
    const mock = fetchMock(jsonResponse([]))
    const client = new SqlPadClient(config('https://host.example/sqlpad'), asFetch(mock))

    await client.get('/api/queries')

    expect(String(mock.mock.calls[0]?.[0])).toBe('https://host.example/sqlpad/api/queries')
  })

  it('does not introduce duplicate slashes for a trailing-slash base URL', async () => {
    const mock = fetchMock(jsonResponse([]))
    const client = new SqlPadClient(config('https://host.example/sqlpad/'), asFetch(mock))

    await client.get('/api/queries')

    expect(String(mock.mock.calls[0]?.[0])).toBe('https://host.example/sqlpad/api/queries')
  })

  it('serializes arrays as repeated bracketed parameters and omits nullish values', async () => {
    const mock = fetchMock(jsonResponse([]))
    const client = new SqlPadClient(config(), asFetch(mock))

    await client.get('/api/queries', {
      tags: ['analytics', 'needs review'],
      search: 'revenue',
      createdBy: null,
      connectionId: undefined,
      limit: 25,
    })

    const requestUrl = new URL(String(mock.mock.calls[0]?.[0]))
    expect(requestUrl.searchParams.getAll('tags[]')).toEqual(['analytics', 'needs review'])
    expect(requestUrl.searchParams.get('search')).toBe('revenue')
    expect(requestUrl.searchParams.get('limit')).toBe('25')
    expect(requestUrl.searchParams.has('createdBy')).toBe(false)
    expect(requestUrl.searchParams.has('connectionId')).toBe(false)
  })

  it.each(['/api/queries/../users', '/api/queries/%2e%2e/users'])(
    'rejects a path containing traversal segments: %s',
    async (path) => {
      const mock = fetchMock(jsonResponse([]))
      const client = new SqlPadClient(config(), asFetch(mock))

      await expect(client.get(path)).rejects.toThrow(/invalid SQLPad request path/i)
      expect(mock).not.toHaveBeenCalled()
    },
  )
})

describe('SqlPadClient requests', () => {
  it('sends the bearer token on every HTTP method', async () => {
    const mock = fetchMock(
      jsonResponse({}),
      jsonResponse({}),
      jsonResponse({}),
      jsonResponse({}),
    )
    const client = new SqlPadClient(config(), asFetch(mock))

    await client.get('/api/app')
    await client.post('/api/queries', { name: 'New query' })
    await client.put('/api/queries/query-1', { name: 'Updated query' })
    await client.del('/api/queries/query-1')

    expect(mock).toHaveBeenCalledTimes(4)
    for (const call of mock.mock.calls) {
      const init = call[1] as RequestInit
      expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${serviceToken}`)
    }
    expect(mock.mock.calls.map((call) => (call[1] as RequestInit).method)).toEqual([
      'GET',
      'POST',
      'PUT',
      'DELETE',
    ])
  })

  it('JSON-encodes request bodies', async () => {
    const mock = fetchMock(jsonResponse({ id: 'query-1' }))
    const client = new SqlPadClient(config(), asFetch(mock))

    await client.post('/api/queries', { name: 'Revenue', tags: ['finance'] })

    const init = mock.mock.calls[0]?.[1] as RequestInit
    expect(new Headers(init.headers).get('content-type')).toBe('application/json')
    expect(init.body).toBe(JSON.stringify({ name: 'Revenue', tags: ['finance'] }))
  })
})

describe('SqlPadClient error mapping', () => {
  it('surfaces a 400 response title and detail as structured metadata', async () => {
    const mock = fetchMock(jsonResponse({
      title: 'Batch text is required',
      detail: 'Provide a non-empty batchText value.',
    }, 400))
    const client = new SqlPadClient(config(), asFetch(mock))

    const error = await caught(client.post('/api/queries', {}))

    expect(error.status).toBe(400)
    expect(error.title).toBe('Batch text is required')
    expect(error.detail).toBe('Provide a non-empty batchText value.')
    expect(error.message).toMatch(/rejected the request/i)
  })

  it.each([
    [401, /rejected the service token.*SQLPAD_SERVICE_TOKEN_SECRET/i],
    [403, /requires an admin service token/i],
    [404, /resource was not found/i],
    [500, /internal server error/i],
  ])('maps HTTP %i to an actionable SqlPadError', async (status, message) => {
    const mock = fetchMock(jsonResponse({ title: `HTTP ${status}` }, status))
    const client = new SqlPadClient(config(), asFetch(mock))

    const error = await caught(client.get('/api/connections/missing'))

    expect(error.status).toBe(status)
    expect(error.title).toBe(`HTTP ${status}`)
    expect(error.message).toMatch(message)
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('degrades gracefully when an error response is not JSON', async () => {
    const mock = fetchMock(new Response('<html>upstream failure</html>', {
      status: 418,
      headers: { 'content-type': 'text/html' },
    }))
    const client = new SqlPadClient(config(), asFetch(mock))

    const error = await caught(client.get('/api/app'))

    expect(error.status).toBe(418)
    expect(error.message).toMatch(/SQLPad|request|418/i)
    expect(error.title).toBeUndefined()
    expect(error.detail).toBeUndefined()
  })

  it('redacts the service token from server-controlled error content', async () => {
    const secret = 'server-must-not-leak-this-token'
    const mock = fetchMock(jsonResponse({
      title: `Invalid token ${secret}`,
      detail: `Authentication failed for Bearer ${secret}`,
    }, 400))
    const client = new SqlPadClient({ ...config(), serviceToken: secret }, asFetch(mock))

    const error = await caught(client.get('/api/app'))
    const observableError = JSON.stringify({
      message: error.message,
      title: error.title,
      detail: error.detail,
      stack: error.stack,
      cause: error.cause,
    })

    expect(observableError).not.toContain(secret)
    expect(error.title).toContain('[REDACTED]')
    expect(error.detail).toContain('[REDACTED]')
  })
})

describe('SqlPadClient retry policy', () => {
  it('retries a network error exactly once and can recover', async () => {
    const mock = fetchMock(new TypeError('socket closed'), jsonResponse({ ok: true }))
    const client = new SqlPadClient(config(), asFetch(mock))

    await expect(client.get('/api/app')).resolves.toEqual({ ok: true })
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('reports a persistent network error after exactly one retry', async () => {
    const mock = fetchMock(new TypeError('first failure'), new TypeError('second failure'))
    const client = new SqlPadClient(config(), asFetch(mock))

    const error = await caught(client.get('/api/app'))

    expect(mock).toHaveBeenCalledTimes(2)
    expect(error.message).toMatch(/network|connect|request/i)
  })

  it('retries a 503 response exactly once', async () => {
    const mock = fetchMock(
      jsonResponse({ title: 'Temporarily unavailable' }, 503),
      jsonResponse({ version: '7.5.0', config: {} }),
    )
    const client = new SqlPadClient(config(), asFetch(mock))

    await expect(client.getAppInfo()).resolves.toMatchObject({ version: '7.5.0' })
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('never retries a 400 response', async () => {
    const mock = fetchMock(jsonResponse({ title: 'Invalid query' }, 400))
    const client = new SqlPadClient(config(), asFetch(mock))

    await caught(client.get('/api/queries'))

    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('never retries POST /api/batches, even for a retryable status', async () => {
    const mock = fetchMock(jsonResponse({ title: 'Temporarily unavailable' }, 503))
    const client = new SqlPadClient(config(), asFetch(mock))

    const error = await caught(client.post('/api/batches', {
      connectionId: 'connection-1',
      batchText: 'select 1',
    }))

    expect(error.status).toBe(503)
    expect(mock).toHaveBeenCalledTimes(1)
  })
})
