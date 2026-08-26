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
})
