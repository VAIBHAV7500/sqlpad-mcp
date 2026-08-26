import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { SqlPadClient } from '../client/SqlPadClient.js'
import type { SqlPadConfig } from '../config.js'
import type { Connection } from '../types.js'

const connectionId = z.string().min(1)
  .describe('The SQLPad connection ID.')
const connectionConfig = z.record(z.unknown())
  .describe('A SQLPad connection configuration to validate without saving it.')
const collectionLimit = z.number().int().min(1).max(500).optional().default(100)
  .describe('Maximum number of users to return. Defaults to 100 and is capped at 500.')

const ADMIN_TOOL_NAMES = [
  'get_connection',
  'test_connection',
  'list_users',
] as const

function structured(value: Record<string, unknown>): CallToolResult {
  return { structuredContent: value } as unknown as CallToolResult
}

export function registerAdminTools(
  server: McpServer,
  client: SqlPadClient,
  _config?: SqlPadConfig,
): string[] {
  void _config

  server.registerTool('get_connection', {
    title: 'Get SQLPad connection',
    description: 'Get one SQLPad connection by ID. This SQLPad endpoint requires an admin service token.',
    inputSchema: { connectionId },
    outputSchema: { connection: z.any() },
  }, async ({ connectionId: id }) => {
    const connection = await client.get<Connection>(
      `/api/connections/${encodeURIComponent(id)}`,
    )
    return structured({ connection })
  })

  server.registerTool('test_connection', {
    title: 'Test SQLPad connection',
    description: 'Test a SQLPad connection configuration without saving it. This SQLPad endpoint requires an admin service token.',
    inputSchema: { connection: connectionConfig },
    outputSchema: { result: z.any() },
  }, async ({ connection }) => {
    const result = await client.post<unknown>('/api/test-connection', connection)
    return structured({ result })
  })

  server.registerTool('list_users', {
    title: 'List SQLPad users',
    description: 'List SQLPad users with explicit output bounds. The MCP server exposes this authenticated endpoint only when admin tools are enabled.',
    inputSchema: { limit: collectionLimit },
    outputSchema: {
      users: z.array(z.any()),
      totalCount: z.number().int().nonnegative(),
      returnedCount: z.number().int().nonnegative(),
      truncated: z.boolean(),
    },
  }, async ({ limit }) => {
    const users = await client.get<unknown[]>('/api/users')
    const boundedUsers = users.slice(0, limit)
    return structured({
      users: boundedUsers,
      totalCount: users.length,
      returnedCount: boundedUsers.length,
      truncated: users.length > boundedUsers.length,
    })
  })

  return [...ADMIN_TOOL_NAMES]
}
