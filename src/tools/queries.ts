import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { SqlPadClient } from '../client/SqlPadClient.js'
import type { SqlPadConfig } from '../config.js'
import type { SavedQuery } from '../types.js'

const limitSchema = z.number().int().min(1).max(100).default(50)
  .describe('Maximum number of items to return (1-100). Defaults to 50.')
const offsetSchema = z.number().int().nonnegative().default(0)
  .describe('Number of items to skip before returning results. Defaults to 0.')

const queryIdSchema = z.string().min(1).describe('SQLPad saved query ID.')
const connectionIdSchema = z.string().min(1).describe('SQLPad connection ID associated with the saved query.')
const queryNameSchema = z.string().min(1).describe('Name of the saved query.')
const queryTextSchema = z.string().describe('SQL text stored in the saved query.')
const tagsSchema = z.array(z.string()).max(100).describe('Tags assigned to the saved query.')
const chartSchema = z.record(z.unknown()).nullable().describe('SQLPad chart configuration, or null.')
const aclSchema = z.array(z.record(z.unknown())).max(100)
  .describe('SQLPad query access-control entries.')

type PageArgs = {
  limit?: number
  offset?: number
}

type QueryWriteArgs = {
  name: string
  connectionId: string
  queryText: string
  tags?: string[]
  chart?: Record<string, unknown> | null
  acl?: Array<Record<string, unknown>>
}

function page<T>(items: T[], limit: number, offset: number) {
  const pagedItems = items.slice(offset, offset + limit)
  return {
    items: pagedItems,
    limit,
    offset,
    returnedCount: pagedItems.length,
    totalCount: items.length,
    truncated: offset + pagedItems.length < items.length,
  }
}

function queryBody(args: QueryWriteArgs): Record<string, unknown> {
  return {
    name: args.name,
    connectionId: args.connectionId,
    queryText: args.queryText,
    ...(args.tags === undefined ? {} : { tags: args.tags }),
    ...(args.chart === undefined ? {} : { chart: args.chart }),
    ...(args.acl === undefined ? {} : { acl: args.acl }),
  }
}

function structured(value: Record<string, unknown>): CallToolResult {
  return { structuredContent: value } as unknown as CallToolResult
}

export function registerQueryTools(
  server: McpServer,
  client: SqlPadClient,
  _config?: SqlPadConfig,
): string[] {
  void _config
  const registered = [
    'list_queries',
    'get_query',
    'list_tags',
    'list_query_history',
    'format_sql',
  ]

  server.registerTool('list_queries', {
    title: 'List Saved Queries',
    description: 'List saved SQLPad queries using optional connection, text, tag, ownership, creator, and sort filters.',
    inputSchema: {
      connectionId: z.string().min(1).optional().describe('Only return queries for this connection ID.'),
      search: z.string().optional().describe('Case-insensitive text to find in query names or SQL text.'),
      tags: z.array(z.string()).max(100).optional().describe('Only return queries having every supplied tag.'),
      sortBy: z.enum(['-updatedAt', '+updatedAt', '-name', '+name']).optional()
        .describe('Sort field and direction.'),
      ownedByUser: z.boolean().optional().describe('Filter by whether the calling user owns the query.'),
      createdBy: z.string().min(1).optional().describe('Only return queries created by this user ID.'),
      limit: limitSchema,
      offset: offsetSchema,
    },
    outputSchema: {
      queries: z.array(z.unknown()),
      limit: z.number().int(),
      offset: z.number().int(),
      returnedCount: z.number().int(),
      truncated: z.boolean(),
    },
  }, async (args) => {
    const limit = args.limit ?? 50
    const offset = args.offset ?? 0
    const queries = await client.get<SavedQuery[]>('/api/queries', {
      connectionId: args.connectionId,
      search: args.search,
      tags: args.tags,
      sortBy: args.sortBy,
      ownedByUser: args.ownedByUser,
      createdBy: args.createdBy,
      limit,
      offset,
    })

    return structured({
      queries,
      limit,
      offset,
      returnedCount: queries.length,
      truncated: queries.length === limit,
    })
  })

  server.registerTool('get_query', {
    title: 'Get Saved Query',
    description: 'Get one saved SQLPad query by ID.',
    inputSchema: { id: queryIdSchema },
    outputSchema: { query: z.unknown() },
  }, async ({ id }) => {
    const query = await client.get<SavedQuery>(`/api/queries/${encodeURIComponent(id)}`)
    return structured({ query })
  })

  server.registerTool('list_tags', {
    title: 'List Query Tags',
    description: 'List distinct saved-query tags, with bounded local pagination.',
    inputSchema: { limit: limitSchema, offset: offsetSchema },
    outputSchema: {
      tags: z.array(z.string()),
      limit: z.number().int(),
      offset: z.number().int(),
      returnedCount: z.number().int(),
      totalCount: z.number().int(),
      truncated: z.boolean(),
    },
  }, async (args: PageArgs) => {
    const tags = await client.get<string[]>('/api/tags')
    const result = page(tags, args.limit ?? 50, args.offset ?? 0)
    return structured({
      tags: result.items,
      limit: result.limit,
      offset: result.offset,
      returnedCount: result.returnedCount,
      totalCount: result.totalCount,
      truncated: result.truncated,
    })
  })

  server.registerTool('list_query_history', {
    title: 'List Query History',
    description: 'List the calling user\'s SQLPad query history, newest first, with bounded local pagination.',
    inputSchema: { limit: limitSchema, offset: offsetSchema },
    outputSchema: {
      history: z.array(z.unknown()),
      limit: z.number().int(),
      offset: z.number().int(),
      returnedCount: z.number().int(),
      totalCount: z.number().int(),
      truncated: z.boolean(),
    },
  }, async (args: PageArgs) => {
    const history = await client.get<unknown[]>('/api/query-history')
    const result = page(history, args.limit ?? 50, args.offset ?? 0)
    return structured({
      history: result.items,
      limit: result.limit,
      offset: result.offset,
      returnedCount: result.returnedCount,
      totalCount: result.totalCount,
      truncated: result.truncated,
    })
  })

  server.registerTool('format_sql', {
    title: 'Format SQL',
    description: 'Format SQL text using SQLPad. Older SQLPad servers may not provide this endpoint.',
    inputSchema: {
      query: z.string().min(1).max(100_000).describe('SQL text to format.'),
    },
    outputSchema: { query: z.string() },
  }, async ({ query }) => {
    const formatted = await client.post<{ query: string }>('/api/format-sql', { query })
    return structured(formatted)
  })

  return registered
}

export function registerQueryWriteTools(
  server: McpServer,
  client: SqlPadClient,
  _config?: SqlPadConfig,
): string[] {
  void _config
  const registered = ['create_query', 'update_query', 'delete_query']
  const writeInputSchema = {
    name: queryNameSchema,
    connectionId: connectionIdSchema,
    queryText: queryTextSchema,
    tags: tagsSchema.optional(),
    chart: chartSchema.optional(),
    acl: aclSchema.optional(),
  }

  server.registerTool('create_query', {
    title: 'Create Saved Query',
    description: 'Create a saved SQLPad query.',
    inputSchema: writeInputSchema,
    outputSchema: { query: z.unknown() },
  }, async (args: QueryWriteArgs) => {
    const query = await client.post<SavedQuery>('/api/queries', queryBody(args))
    return structured({ query })
  })

  server.registerTool('update_query', {
    title: 'Update Saved Query',
    description: 'Replace the editable fields of an existing saved SQLPad query.',
    inputSchema: { id: queryIdSchema, ...writeInputSchema },
    outputSchema: { query: z.unknown() },
  }, async ({ id, ...args }) => {
    const query = await client.put<SavedQuery>(
      `/api/queries/${encodeURIComponent(id)}`,
      queryBody(args),
    )
    return structured({ query })
  })

  server.registerTool('delete_query', {
    title: 'Delete Saved Query',
    description: 'Permanently delete a saved SQLPad query.',
    inputSchema: { id: queryIdSchema },
    outputSchema: { id: z.string(), deleted: z.boolean() },
  }, async ({ id }) => {
    await client.del<unknown>(`/api/queries/${encodeURIComponent(id)}`)
    return structured({ id, deleted: true })
  })

  return registered
}
