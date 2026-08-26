import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { SqlPadClient } from '../client/SqlPadClient.js'
import type { SqlPadConfig } from '../config.js'
import { runSql } from '../execution/runSql.js'
import { formatRows } from '../format/rows.js'
import type { Batch, Statement } from '../types.js'

const connectionIdParam = z.string().min(1)
  .describe('The SQLPad connection ID used to execute or cancel the batch.')
const sqlParam = z.string().min(1)
  .describe('The SQL text to execute. It may contain multiple statements.')
const nameParam = z.string().min(1).optional()
  .describe('An optional display name for the SQLPad batch.')
const queryIdParam = z.string().min(1).optional()
  .describe('The optional saved-query ID associated with this execution.')
const batchIdParam = z.string().min(1)
  .describe('The SQLPad batch ID.')
const statementIdParam = z.string().min(1)
  .describe('The SQLPad statement ID.')
const offsetParam = z.number().int().nonnegative().optional().default(0)
  .describe('Zero-based row offset. Defaults to 0.')
const limitParam = z.number().int().positive().optional()
  .describe('Maximum rows to return. Defaults to, and is capped by, the configured maximum row count.')
const maxRowsParam = z.number().int().positive().optional()
  .describe('Maximum rows to return per finished statement. Defaults to, and is capped by, the server maxRows setting.')

const columnOutput = z.object({
  name: z.string(),
  datatype: z.string().nullable(),
})
const formattedRowsOutput = z.object({
  columns: z.array(columnOutput),
  rows: z.array(z.record(z.unknown())),
  rowCount: z.number().int().nonnegative(),
  returnedRowCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
})
const statementOutput = z.object({
  statementId: z.string(),
  sequence: z.number(),
  statementText: z.string(),
  status: z.string(),
  durationMs: z.number().optional(),
  error: z.object({
    title: z.string().optional(),
    detail: z.string().optional(),
    hint: z.string().optional(),
  }).optional(),
  results: formattedRowsOutput.optional(),
})
const runSqlOutput = {
  batchId: z.string(),
  status: z.string(),
  timedOut: z.boolean(),
  statements: z.array(statementOutput),
}
const batchOutput = { batch: z.record(z.unknown()) }
const statementResultsOutput = {
  statementId: z.string(),
  status: z.string(),
  offset: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  columns: z.array(columnOutput),
  rows: z.array(z.record(z.unknown())),
  rowCount: z.number().int().nonnegative(),
  returnedRowCount: z.number().int().nonnegative(),
  truncated: z.boolean(),
}

function encoded(value: string): string {
  return encodeURIComponent(value)
}

function structured(value: unknown): CallToolResult {
  return { structuredContent: value as Record<string, unknown> } as unknown as CallToolResult
}

export function registerExecutionTools(
  server: McpServer,
  client: SqlPadClient,
  config: SqlPadConfig,
): string[] {
  server.registerTool('run_sql', {
    title: 'Run SQL',
    description: 'Execute arbitrary SQL, including DDL and DML, by creating an asynchronous SQLPad batch, polling it to completion, and returning rows inline. This tool is NOT sandboxed and does not enforce read-only access; read-only enforcement belongs on the SQLPad connection\'s database credentials. Connections may have no default database; qualify table names as schema.table and use get_connection_schema to discover schemas. Returned rows are capped by maxRows and any truncation is reported explicitly. On timeout it returns a batchId and current statuses so execution can be resumed with get_batch instead of re-running the SQL.',
    inputSchema: {
      connectionId: connectionIdParam,
      sql: sqlParam,
      name: nameParam,
      queryId: queryIdParam,
      maxRows: maxRowsParam,
    },
    outputSchema: runSqlOutput,
  }, async ({ connectionId, sql, name, queryId, maxRows }) => {
    const result = await runSql(client, {
      connectionId,
      sql,
      name,
      queryId,
      maxRows: Math.min(maxRows ?? config.maxRows, config.maxRows),
      timeoutMs: config.timeoutMs,
      pollIntervalMs: config.pollIntervalMs,
    })
    return structured(result)
  })

  server.registerTool('get_batch', {
    title: 'Get Batch',
    description: 'Get a SQLPad batch and its current statement statuses. Batch execution is asynchronous, so call this after run_sql times out or while a batch is still queued or running.',
    inputSchema: { batchId: batchIdParam },
    outputSchema: batchOutput,
  }, async ({ batchId }) => {
    const batch = await client.get<Batch>(`/api/batches/${encoded(batchId)}`)
    return structured({ batch })
  })

  server.registerTool('get_statement_results', {
    title: 'Get Statement Results',
    description: 'Page through a large finished statement result instead of re-running the query. Returns a bounded page converted to objects using statement column names. The statement status is checked first because SQLPad returns 404 for results that are not finished; queued, started, or errored statements do not have fetchable results.',
    inputSchema: {
      statementId: statementIdParam,
      offset: offsetParam,
      limit: limitParam,
    },
    outputSchema: statementResultsOutput,
  }, async ({ statementId, offset, limit }) => {
    const statement = await client.get<Statement>(`/api/statements/${encoded(statementId)}`)
    if (statement.status !== 'finished') {
      throw new Error(`Statement results are not available because the statement status is "${statement.status}".`)
    }

    const rawRows = await client.get<unknown[][]>(
      `/api/statements/${encoded(statementId)}/results`,
    )
    const effectiveLimit = Math.min(limit ?? config.maxRows, config.maxRows)
    const page = rawRows.slice(offset, offset + effectiveLimit)
    const formatted = formatRows(statement.columns, page, effectiveLimit)
    const rowCount = statement.rowCount ?? rawRows.length

    return structured({
      statementId: statement.id,
      status: statement.status,
      offset,
      limit: effectiveLimit,
      ...formatted,
      rowCount,
      truncated: offset + formatted.returnedRowCount < rowCount,
    })
  })

  server.registerTool('cancel_batch', {
    title: 'Cancel Batch',
    description: 'Request cancellation of an asynchronous SQLPad batch. SQLPad rejects cancellation when the connection does not support asynchronous execution.',
    inputSchema: {
      batchId: batchIdParam,
      connectionId: connectionIdParam,
    },
    outputSchema: batchOutput,
  }, async ({ batchId, connectionId }) => {
    const batch = await client.put<Batch>(`/api/batches/${encoded(batchId)}/cancel`, {
      connectionId,
    })
    return structured({ batch })
  })

  return ['run_sql', 'get_batch', 'get_statement_results', 'cancel_batch']
}
