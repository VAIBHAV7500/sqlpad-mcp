# SQLPad MCP Server

[![npm version](https://img.shields.io/npm/v/sqlpad-mcp.svg)](https://www.npmjs.com/package/sqlpad-mcp)
[![license: MIT](https://img.shields.io/npm/l/sqlpad-mcp.svg)](./LICENSE)
[![node](https://img.shields.io/node/v/sqlpad-mcp.svg)](https://nodejs.org)

An [MCP](https://modelcontextprotocol.io/) server for [SQLPad](https://github.com/sqlpad/sqlpad). Point an AI agent at a SQLPad instance with its base URL and a service token, and the agent can discover connections, inspect schemas, run SQL, and manage saved queries.

## Requirements

- Node.js 20 or later.
- A reachable SQLPad instance.
- The SQLPad server must have `SQLPAD_SERVICE_TOKEN_SECRET` configured. Without it, every Bearer-authenticated request returns `401 Unauthorized`.
- A service token generated in the SQLPad admin GUI.

## Quick start

No install step is needed — run it straight from npm:

```sh
SQLPAD_SERVICE_TOKEN=... npx sqlpad-mcp --base-url https://sqlpad.example.com
```

Or install it globally:

```sh
npm install -g sqlpad-mcp
```

The server speaks MCP over stdio, so it is normally launched by an MCP client rather than by hand. Running it directly is still useful to verify credentials: on success it logs the detected SQLPad version to stderr.

## Configuration

| Env var | CLI flag | Default | Meaning |
| --- | --- | --- | --- |
| `SQLPAD_BASE_URL` | `--base-url` | (required) | Base URL of the SQLPad instance; a subpath mount is supported. |
| `SQLPAD_SERVICE_TOKEN` | `--token` | (required) | Service token, sent as `Authorization: Bearer`. |
| `SQLPAD_ALLOW_WRITES` | `--allow-writes` | `false` | Register the saved-query write tools. |
| `SQLPAD_ALLOW_ADMIN` | `--allow-admin` | `false` | Register the admin-only tools. |
| `SQLPAD_MAX_ROWS` | `--max-rows` | `500` | Cap on rows returned per statement. |
| `SQLPAD_TIMEOUT_MS` | `--timeout-ms` | `60000` | How long to poll a batch before returning a resumable `batchId`. |

A CLI flag takes precedence over the corresponding environment variable. The batch poll interval (250 ms) is internal and not configurable.

## Claude Code configuration

Add the server to your Claude Code `mcp.json`:

```json
{
  "mcpServers": {
    "sqlpad": {
      "type": "stdio",
      "command": "npx",
      "args": [
        "-y",
        "sqlpad-mcp",
        "--base-url",
        "https://sqlpad.example.com"
      ],
      "env": {
        "SQLPAD_SERVICE_TOKEN": "..."
      }
    }
  }
}
```

Supplying the token through `env` keeps it out of the process argument list, which is world-readable through `ps`.

To enable the gated tool groups, add `"SQLPAD_ALLOW_WRITES": "true"` or `"SQLPAD_ALLOW_ADMIN": "true"` to the same `env` block.

## Tools

Twelve tools are always registered. Six more are gated behind the two `SQLPAD_ALLOW_*` flags and are off by default.

### Execution

| Tool | Description |
| --- | --- |
| `run_sql` | Execute arbitrary SQL, including DDL and DML, by creating an asynchronous SQLPad batch, polling it to completion, and returning rows inline. Not sandboxed. Rows are capped by `maxRows` and truncation is reported explicitly. On timeout it returns a `batchId` so execution can be resumed rather than re-run. A failed statement carries an `error.hint` when the cause is recognizable, such as a table name that needs `schema.` qualification. |
| `get_batch` | Get a batch and its current statement statuses. Call this after `run_sql` times out, or while a batch is still queued or running. |
| `get_statement_results` | Page through a large finished statement result instead of re-running the query. Returns a bounded page converted to objects using the statement's column names. |
| `cancel_batch` | Request cancellation of an asynchronous batch. SQLPad rejects cancellation when the connection does not support asynchronous execution. |

### Discovery

| Tool | Description |
| --- | --- |
| `list_connections` | List the connections available to the service token. Works with a non-admin token, unlike `get_connection`. |
| `get_connection_schema` | Get a bounded database schema for a connection. Unfiltered full-schema output can be enormous — prefer `schemaFilter` or `tableFilter`, and use summary mode unless column details are needed. |
| `list_drivers` | List SQLPad database drivers, bounded by the requested limit. |

### Saved queries

| Tool | Description |
| --- | --- |
| `list_queries` | List saved queries using optional connection, text, tag, ownership, creator, and sort filters. |
| `get_query` | Get one saved query by ID. |
| `list_tags` | List distinct saved-query tags, with bounded local pagination. |
| `list_query_history` | List the calling user's query history, newest first, with bounded local pagination. |
| `format_sql` | Format SQL text using SQLPad. Older SQLPad servers may not provide this endpoint. |

### Saved-query writes — requires `SQLPAD_ALLOW_WRITES=true`

| Tool | Description |
| --- | --- |
| `create_query` | Create a saved query. |
| `update_query` | Replace the editable fields of an existing saved query. |
| `delete_query` | Permanently delete a saved query. |

### Admin — requires `SQLPAD_ALLOW_ADMIN=true`

These call SQLPad endpoints that themselves require an admin service token.

| Tool | Description |
| --- | --- |
| `get_connection` | Get one connection by ID. |
| `test_connection` | Test a connection configuration without saving it. |
| `list_users` | List SQLPad users, with explicit output bounds. |

## How SQL execution works

SQLPad executes SQL through asynchronous batches. Creating a batch returns immediately; each statement moves from `queued` to `started`, then to `finished` or `error`. Results are fetched separately for each statement and are unavailable until that statement is finished.

The `run_sql` tool absorbs the full protocol — create, poll, fetch, and return rows — so an agent makes one call. If polling reaches the configured timeout, the tool returns a `batchId` that the agent can resume with instead of hanging.

Connections may have no default database. Qualify table names as `schema.table`, and use `get_connection_schema` to discover available schemas.

## Security

- `run_sql` executes arbitrary SQL, including DDL and DML, and is not sandboxed. `SQLPAD_ALLOW_WRITES` only gates mutation of SQLPad's own saved-query objects; it does not restrict SQL content. Use read-only database credentials on the SQLPad connection itself. That is the only real enforcement.
- SQLPad's `/api/service-tokens` endpoints are deliberately not exposed. A tool that mints credentials is a privilege-escalation primitive.
- Admin tools are off by default.
- The service token is redacted from all errors and logs. All logging goes to stderr because stdout is the JSON-RPC channel.
- Batches are scoped to the token's own user, so the server only ever sees its own query history.

## Contributing

Clone the repo and install dependencies:

```sh
git clone https://github.com/VAIBHAV7500/sqlpad-mcp.git
cd sqlpad-mcp
npm install
npm run build
```

Create a branch for your change. Before opening a pull request, run:

```sh
npm run typecheck && npm run lint && npm test
```

CI runs the same three commands on Node 20 and 22.

## License

[MIT](./LICENSE)
