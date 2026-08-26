#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { SqlPadClient } from './client/SqlPadClient.js'
import { setRedactionSecret, SqlPadError } from './client/errors.js'
import { loadConfig } from './config.js'
import * as logger from './logger.js'
import { registerAllTools } from './tools/register.js'

const SERVER_INSTRUCTIONS = `SQLPad executes SQL through asynchronous batches. Use run_sql as the primary tool: it creates a batch, polls it, and returns bounded rows for statements that finish. If run_sql times out, keep its batchId and resume with get_batch rather than submitting the SQL again. For large finished results, use get_statement_results with offset and limit to page through the existing statement. SQL execution is not sandboxed; database read-only enforcement must come from the SQLPad connection's database credentials.`

async function preflight(client: SqlPadClient): Promise<void> {
  try {
    const app = await client.getAppInfo()
    logger.info(`Connected to SQLPad ${app.version}`)
  } catch (cause) {
    if (cause instanceof SqlPadError && cause.status === 401) {
      logger.error(cause.message)
      process.exit(1)
    }
    logger.warn('SQLPad startup preflight failed; continuing so the MCP server can start.', cause)
  }
}

async function main(): Promise<void> {
  const config = loadConfig()
  setRedactionSecret(config.serviceToken)
  const client = new SqlPadClient(config)

  await preflight(client)

  const server = new McpServer({
    name: 'sqlpad-mcp',
    version: '0.1.0',
  }, {
    instructions: SERVER_INSTRUCTIONS,
  })
  registerAllTools(server, client, config)

  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch((cause: unknown) => {
  logger.error('SQLPad MCP server failed to start.', cause)
  process.exit(1)
})
