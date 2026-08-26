import { describe, expect, it, vi } from 'vitest'
import { SqlPadClient } from '../src/client/SqlPadClient.js'
import type { SqlPadConfig } from '../src/config.js'
import { runSql } from '../src/execution/runSql.js'

const config: SqlPadConfig = {
  baseUrl: 'https://sqlpad.example.com',
  serviceToken: 'test-token',
  allowWrites: false,
  allowAdmin: false,
  maxRows: 500,
  timeoutMs: 60_000,
  pollIntervalMs: 250,
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function errorResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fetchSequence(...bodies: unknown[]): ReturnType<typeof vi.fn> {
  const mock = vi.fn()
  for (const body of bodies) mock.mockResolvedValueOnce(jsonResponse(body))
  return mock
}

function statement(id: string, sequence: number, status: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    batchId: 'batch-1',
    sequence,
    statementText: `select ${sequence}`,
    status,
    startTime: null,
    stopTime: null,
    durationMs: null,
    rowCount: null,
    resultsPath: null,
    columns: null,
    error: null,
    ...overrides,
  }
}

function batch(status: string, statements: unknown[]) {
  return {
    id: 'batch-1',
    queryId: null,
    name: null,
    connectionId: 'connection-1',
    connectionClientId: null,
    status,
    startTime: '',
    stopTime: null,
    durationMs: null,
    batchText: 'select 1',
    selectedText: null,
    chart: null,
    userId: 'user-1',
    createdAt: '',
    updatedAt: '',
    statements,
  }
}

function options(overrides: Partial<Parameters<typeof runSql>[1]> = {}) {
  return {
    connectionId: 'connection-1',
    sql: 'select 1',
    maxRows: 10,
    timeoutMs: 10_000,
    pollIntervalMs: 100,
    ...overrides,
  }
}

function clientWith(mock: ReturnType<typeof vi.fn>): SqlPadClient {
  return new SqlPadClient(config, mock as unknown as typeof fetch)
}

const noWait = async (): Promise<void> => undefined

describe('runSql', () => {
  it('polls queued to started to finished, then fetches and zips results', async () => {
    const columns = [
      { name: 'id', datatype: 'number', min: 1, max: 1, maxValueLength: 1, maxLineLength: 1 },
      { name: 'name', datatype: 'string', min: null, max: null, maxValueLength: 3, maxLineLength: 3 },
    ]
    const mock = fetchSequence(
      batch('queued', [statement('statement-1', 1, 'queued')]),
      batch('started', [statement('statement-1', 1, 'started')]),
      batch('finished', [statement('statement-1', 1, 'finished', {
        columns,
        durationMs: 42,
        rowCount: 1,
      })]),
      [[1, 'Ada']],
    )

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result).toEqual({
      batchId: 'batch-1',
      status: 'finished',
      timedOut: false,
      statements: [{
        statementId: 'statement-1',
        sequence: 1,
        statementText: 'select 1',
        status: 'finished',
        durationMs: 42,
        results: {
          columns: [
            { name: 'id', datatype: 'number' },
            { name: 'name', datatype: 'string' },
          ],
          rows: [{ id: 1, name: 'Ada' }],
          rowCount: 1,
          returnedRowCount: 1,
          truncated: false,
        },
      }],
    })
    expect(mock).toHaveBeenCalledTimes(4)
    expect(String(mock.mock.calls[3]?.[0])).toContain('/api/statements/statement-1/results')
    expect(mock.mock.calls.every((call) => !String(call[0]).includes('/schema'))).toBe(true)
  })

  it('returns finished results alongside a later statement error', async () => {
    const finished = statement('statement-1', 1, 'finished', {
      rowCount: 1,
      durationMs: 10,
      columns: [{ name: 'value', datatype: 'number', min: 1, max: 1, maxValueLength: 1, maxLineLength: 1 }],
    })
    const failed = statement('statement-2', 2, 'error', {
      error: { title: 'Query failed', detail: 'Bad syntax' },
    })
    const mock = fetchSequence(
      batch('started', [statement('statement-1', 1, 'started'), statement('statement-2', 2, 'queued')]),
      batch('finished', [finished, failed]),
      [[1]],
    )

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result.statements[0]?.results?.rows).toEqual([{ value: 1 }])
    expect(result.statements[1]).toMatchObject({
      statementId: 'statement-2',
      status: 'error',
      error: { title: 'Query failed', detail: 'Bad syntax' },
    })
    expect(mock).toHaveBeenCalledTimes(3)
  })

  it('short-circuits an immediate batch parsing error without polling or fetching results', async () => {
    const unexpectedStatement = statement('statement-1', 1, 'finished', {
      columns: [{ name: 'value', datatype: 'number', min: 1, max: 1, maxValueLength: 1, maxLineLength: 1 }],
    })
    const mock = fetchSequence(batch('error', [unexpectedStatement]))

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result).toEqual({
      batchId: 'batch-1',
      status: 'error',
      timedOut: false,
      statements: [{
        statementId: 'statement-1',
        sequence: 1,
        statementText: 'select 1',
        status: 'finished',
      }],
    })
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('diagnoses an immediate batch-level statement error without fetching finished results', async () => {
    const failed = statement('statement-1', 1, 'error', {
      error: { title: 'No database selected' },
    })
    const mock = fetchSequence(
      batch('error', [failed]),
      { schemas: [{ name: 'app', tables: [] }] },
    )

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result.statements[0]?.error?.hint).toContain('Available schemas: app.')
    expect(mock).toHaveBeenCalledTimes(2)
    expect(mock.mock.calls.every((call) => !String(call[0]).includes('/results'))).toBe(true)
  })

  it('returns current state on timeout without throwing or fetching unfinished results', async () => {
    const queued = statement('statement-1', 1, 'queued')
    const mock = fetchSequence(batch('queued', [queued]), batch('started', [
      statement('statement-1', 1, 'started'),
    ]))

    const result = await runSql(clientWith(mock), options({ timeoutMs: 50, pollIntervalMs: 50 }), noWait)

    expect(result).toMatchObject({
      batchId: 'batch-1',
      status: 'started',
      timedOut: true,
      statements: [{ statementId: 'statement-1', status: 'started' }],
    })
    expect(mock).toHaveBeenCalledTimes(2)
    expect(mock.mock.calls.every((call) => !String(call[0]).includes('/results'))).toBe(true)
  })

  it('rejects empty SQL before making an HTTP call', async () => {
    const mock = vi.fn()

    await expect(runSql(clientWith(mock), options({ sql: ' \n\t ' }), noWait))
      .rejects.toThrow(/SQL.*empty/i)
    expect(mock).toHaveBeenCalledTimes(0)
  })

  it('doubles polling delays and caps exponential backoff at 2000ms', async () => {
    const queued = statement('statement-1', 1, 'queued')
    const mock = fetchSequence(
      batch('queued', [queued]),
      batch('queued', [queued]),
      batch('queued', [queued]),
      batch('queued', [queued]),
      batch('queued', [queued]),
      batch('queued', [queued]),
      batch('finished', [statement('statement-1', 1, 'error')]),
    )
    const delays: number[] = []
    const sleep = async (delayMs: number): Promise<void> => {
      delays.push(delayMs)
    }

    await runSql(clientWith(mock), options({ pollIntervalMs: 250 }), sleep)

    expect(delays).toEqual([250, 500, 1000, 2000, 2000])
  })

  it('adds a schema-aware hint for a no-default-database statement error', async () => {
    const failed = statement('statement-1', 1, 'error', {
      error: { title: 'No database selected', detail: 'ER_NO_DB_ERROR' },
    })
    const mock = fetchSequence(
      batch('finished', [failed]),
      {
        schemas: [
          { name: 'access_control_service', tables: [] },
          { name: 'analytics', tables: [] },
        ],
      },
    )

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result.statements[0]?.error?.hint).toBe(
      'This connection has no default database; write table names as schema.table. Available schemas: access_control_service, analytics.',
    )
    expect(mock).toHaveBeenCalledTimes(2)
    expect(String(mock.mock.calls[1]?.[0])).toContain('/api/connections/connection-1/schema')
  })

  it.each([
    ["Table 'app.users' doesn't exist", undefined],
    ['Query failed', 'relation "users" does not exist'],
    ['Invalid object name users', undefined],
  ])('adds a schema-qualification hint for unknown table signature %s', async (title, detail) => {
    const failed = statement('statement-1', 1, 'error', {
      error: { title, ...(detail === undefined ? {} : { detail }) },
    })
    const mock = fetchSequence(
      batch('finished', [failed]),
      { schemas: [{ name: 'app', tables: [] }] },
    )

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result.statements[0]?.error?.hint).toContain(
      'qualify it as schema.table. Available schemas: app.',
    )
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('does not fetch schemas or add a hint for a non-matching syntax error', async () => {
    const failed = statement('statement-1', 1, 'error', {
      error: { title: 'Syntax error', detail: 'Unexpected token near FROM' },
    })
    const mock = fetchSequence(batch('finished', [failed]))

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result.statements[0]?.error).toEqual({
      title: 'Syntax error',
      detail: 'Unexpected token near FROM',
    })
    expect(result.statements[0]?.error).not.toHaveProperty('hint')
    expect(mock).toHaveBeenCalledTimes(1)
  })

  it('preserves the statement error without a hint when the schema fetch rejects', async () => {
    const originalError = { title: 'No database selected', detail: 'ER_NO_DB_ERROR' }
    const failed = statement('statement-1', 1, 'error', { error: originalError })
    const mock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(batch('finished', [failed])))
      .mockRejectedValueOnce(new Error('network unavailable'))
      .mockRejectedValueOnce(new Error('network unavailable'))

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result.statements[0]?.error).toEqual(originalError)
  })

  it('preserves the statement error without a hint when the schema fetch returns 403', async () => {
    const originalError = { title: 'No database selected', detail: 'ER_NO_DB_ERROR' }
    const failed = statement('statement-1', 1, 'error', { error: originalError })
    const mock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(batch('finished', [failed])))
      .mockResolvedValueOnce(errorResponse(403, { title: 'Forbidden' }))

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result.statements[0]?.error).toEqual(originalError)
  })

  it('preserves the statement error without a hint for a malformed schema response', async () => {
    const originalError = { title: 'No database selected' }
    const failed = statement('statement-1', 1, 'error', { error: originalError })
    const mock = fetchSequence(
      batch('finished', [failed]),
      { schemas: 'not-an-array' },
    )

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result.statements[0]?.error).toEqual(originalError)
  })

  it('stops waiting for a slow schema fetch and preserves the statement error without a hint', async () => {
    vi.useFakeTimers()
    try {
      const originalError = { title: 'No database selected' }
      const failed = statement('statement-1', 1, 'error', { error: originalError })
      const mock = vi.fn()
        .mockResolvedValueOnce(jsonResponse(batch('finished', [failed])))
        .mockImplementationOnce(() => new Promise<Response>(() => undefined))
      const resultPromise = runSql(clientWith(mock), options(), noWait)

      await vi.advanceTimersByTimeAsync(5000)
      const result = await resultPromise

      expect(result.statements[0]?.error).toEqual(originalError)
    } finally {
      vi.useRealTimers()
    }
  })

  it('handles a schema response with no schema names without rendering undefined', async () => {
    const failed = statement('statement-1', 1, 'error', {
      error: { title: 'No database selected' },
    })
    const mock = fetchSequence(batch('finished', [failed]), {})

    const result = await runSql(clientWith(mock), options(), noWait)
    const hint = result.statements[0]?.error?.hint

    expect(hint).toBe('This connection has no default database; write table names as schema.table.')
    expect(hint).not.toContain('undefined')
  })

  it('adds a hint only to the failing statement and fetches schemas once in a mixed batch', async () => {
    const failed = statement('statement-1', 1, 'error', {
      error: { title: 'No database selected' },
    })
    const finished = statement('statement-2', 2, 'finished', {
      columns: [{ name: 'value', datatype: 'number', min: 1, max: 1, maxValueLength: 1, maxLineLength: 1 }],
      rowCount: 1,
    })
    const mock = fetchSequence(
      batch('finished', [failed, finished]),
      { schemas: [{ name: 'app', tables: [] }] },
      [[1]],
    )

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result.statements[0]?.error?.hint).toContain('Available schemas: app.')
    expect(result.statements[1]?.error).toBeUndefined()
    expect(result.statements[1]?.results?.rows).toEqual([{ value: 1 }])
    expect(mock.mock.calls.filter((call) => String(call[0]).includes('/schema'))).toHaveLength(1)
  })

  it('memoizes one schema fetch across multiple failing statements', async () => {
    const failures = [
      statement('statement-1', 1, 'error', { error: { title: 'No database selected' } }),
      statement('statement-2', 2, 'error', { error: { title: "Table 'app.users' doesn't exist" } }),
    ]
    const mock = fetchSequence(
      batch('finished', failures),
      { schemas: [{ name: 'app', tables: [] }] },
    )

    const result = await runSql(clientWith(mock), options(), noWait)

    expect(result.statements.every((item) => item.error?.hint?.includes('schema.table'))).toBe(true)
    expect(mock.mock.calls.filter((call) => String(call[0]).includes('/schema'))).toHaveLength(1)
  })

  it('caps schema names at 20 and points to get_connection_schema when more exist', async () => {
    const failed = statement('statement-1', 1, 'error', {
      error: { title: 'No database selected' },
    })
    const schemas = Array.from({ length: 21 }, (_, index) => ({
      name: `schema_${index + 1}`,
      tables: [],
    }))
    const mock = fetchSequence(batch('finished', [failed]), { schemas })

    const result = await runSql(clientWith(mock), options(), noWait)
    const hint = result.statements[0]?.error?.hint

    expect(hint).toContain('schema_20')
    expect(hint).not.toContain('schema_21')
    expect(hint).toContain('use get_connection_schema')
  })
})
