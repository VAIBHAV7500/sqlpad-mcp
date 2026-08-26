import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { describe, expect, it } from 'vitest'
import { SqlPadClient } from '../src/client/SqlPadClient.js'
import type { SqlPadConfig } from '../src/config.js'
import { registerAllTools } from '../src/tools/register.js'

const CORE_NAMES = [
  'run_sql',
  'get_batch',
  'get_statement_results',
  'cancel_batch',
  'list_connections',
  'get_connection_schema',
  'list_drivers',
  'list_queries',
  'get_query',
  'list_tags',
  'list_query_history',
  'format_sql',
]
const WRITE_NAMES = ['create_query', 'update_query', 'delete_query']
const ADMIN_NAMES = ['get_connection', 'test_connection', 'list_users']

function config(overrides: Partial<SqlPadConfig> = {}): SqlPadConfig {
  return {
    baseUrl: 'https://sqlpad.example.com',
    serviceToken: 'test-token',
    allowWrites: false,
    allowAdmin: false,
    maxRows: 50,
    timeoutMs: 1_000,
    pollIntervalMs: 1,
    ...overrides,
  }
}

function registered(overrides: Partial<SqlPadConfig> = {}): string[] {
  const current = config(overrides)
  const server = new McpServer({ name: 'test', version: '1.0.0' })
  const client = new SqlPadClient(current, (() => Promise.reject(new Error('unused'))) as typeof fetch)
  return registerAllTools(server, client, current)
}

async function visibleTools(overrides: Partial<SqlPadConfig> = {}) {
  const current = config(overrides)
  const server = new McpServer({ name: 'test-server', version: '1.0.0' })
  const sqlPad = new SqlPadClient(
    current,
    (() => Promise.reject(new Error('unused'))) as typeof fetch,
  )
  registerAllTools(server, sqlPad, current)
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  await client.connect(clientTransport)
  try {
    return (await client.listTools()).tools
  } finally {
    await client.close()
  }
}

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name)
    return entry.isDirectory() ? sourceFiles(target) : [target]
  }))
  return nested.flat()
}

describe('registerAllTools', () => {
  it('registers only core tools when writes and admin are disabled', () => {
    const names = registered()
    expect(names).toEqual(CORE_NAMES)
    expect(names).not.toEqual(expect.arrayContaining([...WRITE_NAMES, ...ADMIN_NAMES]))
  })

  it('adds all three write tools when writes are enabled', () => {
    expect(registered({ allowWrites: true })).toEqual([...CORE_NAMES, ...WRITE_NAMES])
  })

  it('adds all three admin tools when admin is enabled', () => {
    expect(registered({ allowAdmin: true })).toEqual([...CORE_NAMES, ...ADMIN_NAMES])
  })

  it('keeps the MCP-visible tools/list surface honest when gated tools are disabled', async () => {
    const tools = await visibleTools()
    expect(tools.map((tool) => tool.name)).toEqual(CORE_NAMES)
    for (const tool of tools) {
      expect(tool.title).toBeTruthy()
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema.type).toBe('object')
      expect(tool.outputSchema).toBeDefined()
    }
  })

  it('never registers a service-token tool', () => {
    expect(registered({ allowWrites: true, allowAdmin: true }))
      .not.toEqual(expect.arrayContaining([expect.stringMatching(/service.?token/i)]))
  })

  it('contains no console.log calls under src', async () => {
    const files = await sourceFiles(path.resolve('src'))
    const contents = await Promise.all(files.map((file) => readFile(file, 'utf8')))
    expect(contents.join('\n')).not.toMatch(/console\.log\s*\(/)
  })
})
