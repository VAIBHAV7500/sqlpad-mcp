import type { SqlPadConfig } from '../config.js'
import type { AppInfo } from '../types.js'
import { redact, SqlPadError } from './errors.js'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE'

const RETRYABLE_STATUSES = new Set([502, 503, 504])

function appendQuery(url: URL, query?: Record<string, unknown>): void {
  if (!query) return

  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined) continue

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item !== null && item !== undefined) {
          url.searchParams.append(`${key}[]`, String(item))
        }
      }
      continue
    }

    url.searchParams.append(key, String(value))
  }
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, unknown>): URL {
  const url = new URL(baseUrl)
  const basePath = url.pathname.replace(/\/+$/, '')
  const requestPath = path.replace(/^\/+/, '')

  for (const segment of requestPath.split('/')) {
    let decodedSegment: string
    try {
      decodedSegment = decodeURIComponent(segment)
    } catch {
      throw new SqlPadError('Invalid SQLPad request path.')
    }
    if (decodedSegment === '.' || decodedSegment === '..') {
      throw new SqlPadError('Invalid SQLPad request path.')
    }
  }

  url.pathname = `${basePath}/${requestPath}`
  url.search = ''
  url.hash = ''
  appendQuery(url, query)
  return url
}

function isErrorBody(value: unknown): value is { title?: string; detail?: string } {
  if (typeof value !== 'object' || value === null) return false

  const body = value as Record<string, unknown>
  return (body.title === undefined || typeof body.title === 'string')
    && (body.detail === undefined || typeof body.detail === 'string')
}

async function parseErrorBody(response: Response): Promise<{ title?: string; detail?: string }> {
  try {
    const text = await response.text()
    if (!text) return {}

    const parsed: unknown = JSON.parse(text)
    return isErrorBody(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

async function discardBody(response: Response): Promise<void> {
  try {
    await response.arrayBuffer()
  } catch {
    // A failed best-effort body drain must not prevent the retry.
  }
}

export class SqlPadClient {
  private readonly config: SqlPadConfig
  private readonly fetchImpl: typeof fetch

  constructor(config: SqlPadConfig, fetchImpl: typeof fetch = fetch) {
    this.config = config
    this.fetchImpl = fetchImpl
  }

  get<T>(path: string, query?: Record<string, unknown>): Promise<T> {
    return this.request<T>('GET', path, undefined, query)
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body)
  }

  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body)
  }

  del<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path)
  }

  getAppInfo(): Promise<AppInfo> {
    return this.get<AppInfo>('/api/app')
  }

  private async request<T>(
    method: HttpMethod,
    path: string,
    body?: unknown,
    query?: Record<string, unknown>,
  ): Promise<T> {
    const url = buildUrl(this.config.baseUrl, path, query)
    const normalizedPath = path.replace(/^\/+|\/+$/g, '')
    const canRetry = !(method === 'POST' && normalizedPath === 'api/batches')

    for (let attempt = 0; attempt < 2; attempt += 1) {
      let response: Response

      try {
        response = await this.fetchImpl(url.toString(), {
          method,
          headers: {
            Authorization: `Bearer ${this.config.serviceToken}`,
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        })
      } catch (cause) {
        if (canRetry && attempt === 0) continue
        throw new SqlPadError('Unable to reach SQLPad. Check the server URL and network connection.', {
          cause: redact(cause, this.config.serviceToken),
        })
      }

      if (canRetry && attempt === 0 && RETRYABLE_STATUSES.has(response.status)) {
        await discardBody(response)
        continue
      }

      if (!response.ok) {
        const errorBody = await parseErrorBody(response)
        const title = errorBody.title === undefined
          ? undefined
          : redact(errorBody.title, this.config.serviceToken)
        const detail = errorBody.detail === undefined
          ? undefined
          : redact(errorBody.detail, this.config.serviceToken)
        throw new SqlPadError(
          title ?? `SQLPad request failed with status ${response.status}.`,
          {
            status: response.status,
            title,
            detail,
          },
        )
      }

      try {
        return await response.json() as T
      } catch (cause) {
        throw new SqlPadError('SQLPad returned an invalid JSON response.', {
          cause: redact(cause, this.config.serviceToken),
        })
      }
    }

    throw new SqlPadError('SQLPad request failed.')
  }
}
