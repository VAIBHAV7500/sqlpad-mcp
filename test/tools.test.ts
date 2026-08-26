import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it, vi } from 'vitest'
import { SqlPadClient } from '../src/client/SqlPadClient.js'
import type { SqlPadConfig } from '../src/config.js'
import { registerAllTools } from '../src/tools/register.js'

function config(overrides: Partial<SqlPadConfig> = {}): SqlPadConfig {
  return {
    baseUrl: 'https://sqlpad.example.com/sqlpad',
    serviceToken: 'test-token',
    allowWrites: true,
    allowAdmin: true,
    maxRows: 2,
    timeoutMs: 1_000,
    pollIntervalMs: 1,
    ...overrides,
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function fetchSequence(...bodies: unknown[]): ReturnType<typeof vi.fn> {
  const mock = vi.fn()
  for (const body of bodies) mock.mockResolvedValueOnce(json(body))
  return mock
}

async function withMcp(
  fetchMock: ReturnType<typeof vi.fn>,
  run: (client: Client) => Promise<void>,
  overrides: Partial<SqlPadConfig> = {},
): Promise<void> {
  const current = config(overrides)
  const server = new McpServer({ name: 'test-server', version: '1.0.0' })
  registerAllTools(
    server,
    new SqlPadClient(current, fetchMock as unknown as typeof fetch),
    current,
  )
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()

  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    await run(client)
  } finally {
    await client.close()
  }
}

function requestAt(mock: ReturnType<typeof vi.fn>, index: number): {
  url: URL
  init: RequestInit
  body: unknown
} {
  const call = mock.mock.calls[index]
  const init = call?.[1] as RequestInit
  return {
    url: new URL(String(call?.[0])),
    init,
    body: init.body === undefined ? undefined : JSON.parse(String(init.body)),
  }
}

const columns = [{
  name: 'value',
  datatype: 'number',
  min: 1,
  max: 3,
  maxValueLength: 1,
  maxLineLength: 1,
}]

describe('execution tools', () => {
  it('run_sql creates and polls a batch, returns capped inline rows, and reports truncation', async () => {
    const fetchMock = fetchSequence(
      {
        id: 'batch-1',
        status: 'started',
        statements: [{ id: 'statement-1', sequence: 1, statementText: 'select 1', status: 'started' }],
      },
      {
        id: 'batch-1',
        status: 'finished',
        statements: [{
          id: 'statement-1',
          sequence: 1,
          statementText: 'select 1',
          status: 'finished',
          durationMs: 3,
          rowCount: 3,
          columns,
          error: null,
        }],
      },
      [[1], [2], [3]],
    )

    await withMcp(fetchMock, async (client) => {
      const response = await client.callTool({
        name: 'run_sql',
        arguments: { connectionId: 'connection-1', sql: 'select 1', maxRows: 2 },
      })
      expect(response.structuredContent).toMatchObject({
        batchId: 'batch-1',
        timedOut: false,
        statements: [{
          results: {
            rows: [{ value: 1 }, { value: 2 }],
            rowCount: 3,
            returnedRowCount: 2,
            truncated: true,
          },
        }],
      })
    })

    expect(requestAt(fetchMock, 0)).toMatchObject({
      url: new URL('https://sqlpad.example.com/sqlpad/api/batches'),
      init: { method: 'POST' },
      body: { connectionId: 'connection-1', batchText: 'select 1' },
    })
    expect(requestAt(fetchMock, 1).url.pathname).toBe('/sqlpad/api/batches/batch-1')
    expect(requestAt(fetchMock, 2).url.pathname).toBe('/sqlpad/api/statements/statement-1/results')
  })

  it('get_statement_results honors offset/limit and returns an empty page past the end', async () => {
    const finished = {
      id: 'statement-1', status: 'finished', rowCount: 3, columns,
    }
    const fetchMock = fetchSequence(finished, [[1], [2], [3]], finished, [[1], [2], [3]])

    await withMcp(fetchMock, async (client) => {
      const page = await client.callTool({
        name: 'get_statement_results',
        arguments: { statementId: 'statement-1', offset: 1, limit: 1 },
      })
      expect(page.structuredContent).toMatchObject({
        offset: 1,
        limit: 1,
        rows: [{ value: 2 }],
        returnedRowCount: 1,
      })

      const pastEnd = await client.callTool({
        name: 'get_statement_results',
        arguments: { statementId: 'statement-1', offset: 10, limit: 1 },
      })
      expect(pastEnd.structuredContent).toMatchObject({
        offset: 10,
        rows: [],
        returnedRowCount: 0,
      })
    })

    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(requestAt(fetchMock, 0).url.pathname).toBe('/sqlpad/api/statements/statement-1')
    expect(requestAt(fetchMock, 1).url.pathname).toBe('/sqlpad/api/statements/statement-1/results')
  })

  it('get_batch and cancel_batch use the exact endpoints and cancellation body', async () => {
    const batch = { id: 'batch-1', status: 'started' }
    const fetchMock = fetchSequence(batch, { ...batch, status: 'finished' })

    await withMcp(fetchMock, async (client) => {
      await client.callTool({ name: 'get_batch', arguments: { batchId: 'batch-1' } })
      const cancelled = await client.callTool({
        name: 'cancel_batch',
        arguments: { batchId: 'batch-1', connectionId: 'connection-1' },
      })
      expect(cancelled.structuredContent).toEqual({ batch: { id: 'batch-1', status: 'finished' } })
    })

    expect(requestAt(fetchMock, 0).init.method).toBe('GET')
    expect(requestAt(fetchMock, 0).url.pathname).toBe('/sqlpad/api/batches/batch-1')
    expect(requestAt(fetchMock, 1)).toMatchObject({
      init: { method: 'PUT' },
      body: { connectionId: 'connection-1' },
    })
    expect(requestAt(fetchMock, 1).url.pathname).toBe('/sqlpad/api/batches/batch-1/cancel')
  })
})

describe('query tools', () => {
  it('list_queries maps every supported filter and paging value into query parameters', async () => {
    const fetchMock = fetchSequence([{ id: 'query-1', name: 'Revenue' }])

    await withMcp(fetchMock, async (client) => {
      const response = await client.callTool({
        name: 'list_queries',
        arguments: {
          connectionId: 'connection-1',
          search: 'revenue',
          tags: ['finance', 'monthly'],
          sortBy: '-updatedAt',
          ownedByUser: true,
          createdBy: 'user-1',
          limit: 10,
          offset: 20,
        },
      })
      expect(response.structuredContent).toMatchObject({ returnedCount: 1, limit: 10, offset: 20 })
    })

    const request = requestAt(fetchMock, 0)
    expect(request.init.method).toBe('GET')
    expect(request.url.pathname).toBe('/sqlpad/api/queries')
    expect(Object.fromEntries(request.url.searchParams)).toMatchObject({
      connectionId: 'connection-1',
      search: 'revenue',
      sortBy: '-updatedAt',
      ownedByUser: 'true',
      createdBy: 'user-1',
      limit: '10',
      offset: '20',
    })
    expect(request.url.searchParams.getAll('tags[]')).toEqual(['finance', 'monthly'])
  })

  it('format_sql posts exactly { query }', async () => {
    const fetchMock = fetchSequence({ query: 'SELECT 1;' })
    await withMcp(fetchMock, async (client) => {
      const response = await client.callTool({
        name: 'format_sql', arguments: { query: 'select 1' },
      })
      expect(response.structuredContent).toEqual({ query: 'SELECT 1;' })
    })
    expect(requestAt(fetchMock, 0)).toMatchObject({
      init: { method: 'POST' },
      body: { query: 'select 1' },
    })
    expect(requestAt(fetchMock, 0).url.pathname).toBe('/sqlpad/api/format-sql')
  })

  it('exercises query reads and all write-gated query handlers', async () => {
    const saved = { id: 'query-1', name: 'Revenue', connectionId: 'connection-1', queryText: 'select 1' }
    const fetchMock = fetchSequence(
      saved,
      ['finance', 'monthly'],
      [{ id: 'batch-1' }, { id: 'batch-2' }],
      saved,
      { ...saved, name: 'Updated' },
      {},
    )

    await withMcp(fetchMock, async (client) => {
      expect((await client.callTool({ name: 'get_query', arguments: { id: 'query-1' } })).structuredContent)
        .toEqual({ query: saved })
      expect((await client.callTool({ name: 'list_tags', arguments: { limit: 1, offset: 1 } })).structuredContent)
        .toMatchObject({ tags: ['monthly'], totalCount: 2 })
      expect((await client.callTool({ name: 'list_query_history', arguments: { limit: 1 } })).structuredContent)
        .toMatchObject({ history: [{ id: 'batch-1' }], truncated: true })

      const writeArgs = {
        name: 'Revenue', connectionId: 'connection-1', queryText: 'select 1', tags: ['finance'],
      }
      await client.callTool({ name: 'create_query', arguments: writeArgs })
      await client.callTool({ name: 'update_query', arguments: { id: 'query-1', ...writeArgs, name: 'Updated' } })
      expect((await client.callTool({ name: 'delete_query', arguments: { id: 'query-1' } })).structuredContent)
        .toEqual({ id: 'query-1', deleted: true })
    })

    expect(requestAt(fetchMock, 0).url.pathname).toBe('/sqlpad/api/queries/query-1')
    expect(requestAt(fetchMock, 1).url.pathname).toBe('/sqlpad/api/tags')
    expect(requestAt(fetchMock, 2).url.pathname).toBe('/sqlpad/api/query-history')
    expect(requestAt(fetchMock, 3)).toMatchObject({
      init: { method: 'POST' },
      body: { name: 'Revenue', connectionId: 'connection-1', queryText: 'select 1', tags: ['finance'] },
    })
    expect(requestAt(fetchMock, 4)).toMatchObject({
      init: { method: 'PUT' },
      body: { name: 'Updated', connectionId: 'connection-1', queryText: 'select 1', tags: ['finance'] },
    })
    expect(requestAt(fetchMock, 5).init.method).toBe('DELETE')
  })
})

describe('discovery and admin tools', () => {
  it('exercises every discovery handler with bounded structured output', async () => {
    const fetchMock = fetchSequence(
      [{ id: 'connection-1' }, { id: 'connection-2' }],
      { schemas: [{ name: 'public', tables: [{ name: 'users', columns: [{ name: 'id', dataType: 'int' }] }] }] },
      [{ id: 'postgres' }, { id: 'mysql' }],
    )
    await withMcp(fetchMock, async (client) => {
      expect((await client.callTool({ name: 'list_connections', arguments: { limit: 1 } })).structuredContent)
        .toMatchObject({ connections: [{ id: 'connection-1' }], truncated: true })
      expect((await client.callTool({
        name: 'get_connection_schema',
        arguments: { connectionId: 'connection-1', mode: 'summary', tableFilter: 'user' },
      })).structuredContent).toMatchObject({
        tableCount: 1,
        schemas: [{ tables: [{ name: 'users', columnCount: 1 }] }],
      })
      expect((await client.callTool({ name: 'list_drivers', arguments: { limit: 1 } })).structuredContent)
        .toMatchObject({ drivers: [{ id: 'postgres' }], truncated: true })
    })
    expect(requestAt(fetchMock, 0).url.pathname).toBe('/sqlpad/api/connections')
    expect(requestAt(fetchMock, 1).url.pathname).toBe('/sqlpad/api/connections/connection-1/schema')
    expect(requestAt(fetchMock, 2).url.pathname).toBe('/sqlpad/api/drivers')
  })

  it('exercises every admin-gated handler with exact methods, paths, and body', async () => {
    const fetchMock = fetchSequence(
      { id: 'connection-1', name: 'Warehouse' },
      { success: true },
      [{ id: 'user-1' }, { id: 'user-2' }],
    )
    await withMcp(fetchMock, async (client) => {
      expect((await client.callTool({
        name: 'get_connection', arguments: { connectionId: 'connection-1' },
      })).structuredContent).toMatchObject({ connection: { id: 'connection-1' } })
      expect((await client.callTool({
        name: 'test_connection', arguments: { connection: { driver: 'postgres', host: 'db' } },
      })).structuredContent).toEqual({ result: { success: true } })
      expect((await client.callTool({ name: 'list_users', arguments: { limit: 1 } })).structuredContent)
        .toMatchObject({ users: [{ id: 'user-1' }], truncated: true })
    })
    expect(requestAt(fetchMock, 0).url.pathname).toBe('/sqlpad/api/connections/connection-1')
    expect(requestAt(fetchMock, 1)).toMatchObject({
      init: { method: 'POST' },
      body: { driver: 'postgres', host: 'db' },
    })
    expect(requestAt(fetchMock, 1).url.pathname).toBe('/sqlpad/api/test-connection')
    expect(requestAt(fetchMock, 2).url.pathname).toBe('/sqlpad/api/users')
  })
})
