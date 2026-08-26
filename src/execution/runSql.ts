import type { SqlPadClient } from '../client/SqlPadClient.js'
import { formatRows, type FormattedRows } from '../format/rows.js'
import type { Batch, Statement } from '../types.js'

export interface RunSqlResult {
  batchId: string
  status: string
  timedOut: boolean
  statements: {
    statementId: string
    sequence: number
    statementText: string
    status: string
    durationMs?: number
    error?: { title?: string; detail?: string }
    results?: FormattedRows
  }[]
}

type Sleep = (delayMs: number) => Promise<void>

const TERMINAL_STATEMENT_STATUSES = new Set(['finished', 'error'])
const TERMINAL_BATCH_STATUSES = new Set(['finished', 'error'])

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs))
}

function isTerminal(batch: Batch): boolean {
  if (TERMINAL_BATCH_STATUSES.has(batch.status)) return true
  const statements = batch.statements ?? []
  return statements.length > 0
    && statements.every((statement) => TERMINAL_STATEMENT_STATUSES.has(statement.status))
}

function statementResult(statement: Statement, results?: FormattedRows): RunSqlResult['statements'][number] {
  return {
    statementId: statement.id,
    sequence: statement.sequence,
    statementText: statement.statementText,
    status: statement.status,
    ...(statement.durationMs === null ? {} : { durationMs: statement.durationMs }),
    ...(statement.error === null ? {} : { error: statement.error }),
    ...(results === undefined ? {} : { results }),
  }
}

async function collectStatements(
  client: SqlPadClient,
  statements: Statement[],
  maxRows: number,
): Promise<RunSqlResult['statements']> {
  const output: RunSqlResult['statements'] = []

  for (const statement of statements) {
    if (statement.status !== 'finished') {
      output.push(statementResult(statement))
      continue
    }

    const rawRows = await client.get<unknown[][]>(
      `/api/statements/${encodeURIComponent(statement.id)}/results`,
    )
    const results = formatRows(statement.columns, rawRows, maxRows)
    if (statement.rowCount !== null) {
      results.rowCount = statement.rowCount
      results.truncated = statement.rowCount > results.returnedRowCount
    }
    output.push(statementResult(statement, results))
  }

  return output
}

async function toResult(
  client: SqlPadClient,
  batch: Batch,
  maxRows: number,
  timedOut: boolean,
): Promise<RunSqlResult> {
  return {
    batchId: batch.id,
    status: batch.status,
    timedOut,
    statements: await collectStatements(client, batch.statements ?? [], maxRows),
  }
}

export async function runSql(client: SqlPadClient, opts: {
  connectionId: string
  sql: string
  name?: string
  queryId?: string
  maxRows: number
  timeoutMs: number
  pollIntervalMs: number
}, sleep: Sleep = defaultSleep): Promise<RunSqlResult> {
  if (opts.sql.trim().length === 0) {
    throw new Error('SQL must not be empty.')
  }

  const requestBody = {
    connectionId: opts.connectionId,
    batchText: opts.sql,
    ...(opts.name === undefined ? {} : { name: opts.name }),
    ...(opts.queryId === undefined ? {} : { queryId: opts.queryId }),
  }
  let batch = await client.post<Batch>('/api/batches', requestBody)

  if (batch.status === 'error') {
    return {
      batchId: batch.id,
      status: batch.status,
      timedOut: false,
      statements: (batch.statements ?? []).map((statement) => statementResult(statement)),
    }
  }

  let intervalMs = opts.pollIntervalMs
  let elapsedMs = 0

  while (!isTerminal(batch)) {
    if (elapsedMs >= opts.timeoutMs) {
      return toResult(client, batch, opts.maxRows, true)
    }

    const requestStartedAt = Date.now()
    batch = await client.get<Batch>(`/api/batches/${encodeURIComponent(batch.id)}`)
    elapsedMs += Date.now() - requestStartedAt
    if (isTerminal(batch)) break

    const remainingMs = opts.timeoutMs - elapsedMs
    if (remainingMs <= 0) {
      return toResult(client, batch, opts.maxRows, true)
    }

    const delayMs = Math.min(intervalMs, remainingMs)
    const sleepStartedAt = Date.now()
    await sleep(delayMs)
    elapsedMs += Math.max(delayMs, Date.now() - sleepStartedAt)
    intervalMs = Math.min(intervalMs * 2, 2000)
  }

  return toResult(client, batch, opts.maxRows, false)
}
