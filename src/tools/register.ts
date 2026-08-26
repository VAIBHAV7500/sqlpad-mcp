import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SqlPadClient } from '../client/SqlPadClient.js'
import type { SqlPadConfig } from '../config.js'
import { registerAdminTools } from './admin.js'
import { registerDiscoveryTools } from './discovery.js'
import { registerExecutionTools } from './execution.js'
import { registerQueryTools, registerQueryWriteTools } from './queries.js'

export function registerAllTools(
  server: McpServer,
  client: SqlPadClient,
  config: SqlPadConfig,
): string[] {
  const names = [
    ...registerExecutionTools(server, client, config),
    ...registerDiscoveryTools(server, client, config),
    ...registerQueryTools(server, client, config),
  ]

  if (config.allowWrites) {
    names.push(...registerQueryWriteTools(server, client, config))
  }

  if (config.allowAdmin) {
    names.push(...registerAdminTools(server, client, config))
  }

  return names
}

