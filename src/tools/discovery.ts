import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { SqlPadClient } from '../client/SqlPadClient.js'
import type { SqlPadConfig } from '../config.js'
import { formatSchema } from '../format/schema.js'
import type { Connection, ConnectionSchema, Driver } from '../types.js'

const collectionLimit = z.number().int().min(1).max(500).optional().default(100)
  .describe('Maximum number of items to return. Defaults to 100 and is capped at 500.')
const connectionId = z.string().min(1)
  .describe('The SQLPad connection ID.')
const schemaFilter = z.string().min(1).optional()
  .describe('Case-insensitive substring used to filter schema names.')
const tableFilter = z.string().min(1).optional()
  .describe('Case-insensitive substring used to filter table names.')
const schemaMode = z.enum(['summary', 'full']).optional().default('summary')
  .describe('Use summary for names and column counts, or full to include column details.')
const maxTables = z.number().int().min(1).max(500).optional().default(100)
  .describe('Maximum number of tables to return. Defaults to 100 and is capped at 500.')

const DISCOVERY_TOOL_NAMES = [
  'list_connections',
  'get_connection_schema',
  'list_drivers',
] as const

function boundItems<T>(items: T[], limit: number): {
  items: T[]
  totalCount: number
  returnedCount: number
  truncated: boolean
} {
  const bounded = items.slice(0, limit)
  return {
    items: bounded,
    totalCount: items.length,
    returnedCount: bounded.length,
    truncated: items.length > bounded.length,
  }
}

function structured(value: Record<string, unknown>): CallToolResult {
  return { structuredContent: value } as unknown as CallToolResult
}

export function registerDiscoveryTools(
  server: McpServer,
  client: SqlPadClient,
  _config?: SqlPadConfig,
): string[] {
  void _config

  server.registerTool('list_connections', {
    title: 'List SQLPad connections',
    description: 'List the SQLPad connections available to the service token. This endpoint works with a non-admin token, unlike get_connection, which requires admin access.',
    inputSchema: { limit: collectionLimit },
    outputSchema: {
      connections: z.array(z.any()),
      totalCount: z.number().int().nonnegative(),
      returnedCount: z.number().int().nonnegative(),
      truncated: z.boolean(),
    },
  }, async ({ limit }) => {
    const connections = await client.get<Connection[]>('/api/connections')
    const bounded = boundItems(connections, limit)
    return structured({
      connections: bounded.items,
      totalCount: bounded.totalCount,
      returnedCount: bounded.returnedCount,
      truncated: bounded.truncated,
    })
  })

  server.registerTool('get_connection_schema', {
    title: 'Get SQLPad connection schema',
    description: 'Get a bounded database schema for a SQLPad connection. Unfiltered full schema output can be enormous; prefer schemaFilter or tableFilter, and use summary mode unless column details are necessary.',
    inputSchema: {
      connectionId,
      schemaFilter,
      tableFilter,
      mode: schemaMode,
      maxTables,
    },
    outputSchema: {
      schemas: z.array(z.any()),
      tableCount: z.number().int().nonnegative(),
      truncated: z.boolean(),
    },
  }, async ({ connectionId: id, schemaFilter: schema, tableFilter: table, mode, maxTables: cap }) => {
    const raw = await client.get<ConnectionSchema>(
      `/api/connections/${encodeURIComponent(id)}/schema`,
    )
    return structured(formatSchema(raw, {
        schemaFilter: schema,
        tableFilter: table,
        mode,
        maxTables: cap,
      }))
  })

  server.registerTool('list_drivers', {
    title: 'List SQLPad drivers',
    description: 'List SQLPad database drivers, bounded by the requested limit.',
    inputSchema: { limit: collectionLimit },
    outputSchema: {
      drivers: z.array(z.any()),
      totalCount: z.number().int().nonnegative(),
      returnedCount: z.number().int().nonnegative(),
      truncated: z.boolean(),
    },
  }, async ({ limit }) => {
    const drivers = await client.get<Driver[]>('/api/drivers')
    const bounded = boundItems(drivers, limit)
    return structured({
      drivers: bounded.items,
      totalCount: bounded.totalCount,
      returnedCount: bounded.returnedCount,
      truncated: bounded.truncated,
    })
  })

  return [...DISCOVERY_TOOL_NAMES]
}
