# SQLPad MCP Server

An [MCP](https://modelcontextprotocol.io/) server for [SQLPad](https://github.com/sqlpad/sqlpad). Point an AI agent at a SQLPad instance with its base URL and a service token, and the agent can discover connections, inspect schemas, run SQL, and manage saved queries.

## Requirements

- Node.js 20 or later.
- A reachable SQLPad instance.
- The SQLPad server must have `SQLPAD_SERVICE_TOKEN_SECRET` configured. Without it, every Bearer-authenticated request returns `401 Unauthorized`.
- A service token generated in the SQLPad admin GUI.

## Install and build

```sh
npm install
npm run build
npm test
```

## Configuration

| Env var | CLI flag | Default | Meaning |
| --- | --- | --- | --- |
| `SQLPAD_BASE_URL` | `--base-url` | (required) | Base URL of the SQLPad instance; a subpath mount is supported. |
| `SQLPAD_SERVICE_TOKEN` | `--token` | (required) | Service token, sent as `Authorization: Bearer`. |
| `SQLPAD_ALLOW_WRITES` | `--allow-writes` | `false` | Register the saved-query write tools. |
| `SQLPAD_ALLOW_ADMIN` | `--allow-admin` | `false` | Register the admin-only tools. |
| `SQLPAD_MAX_ROWS` | `--max-rows` | `500` | Cap on rows returned per statement. |
| `SQLPAD_TIMEOUT_MS` | `--timeout-ms` | `60000` | How long to poll a batch before returning a resumable `batchId`. |

A CLI flag takes precedence over the corresponding environment variable.

## Claude Code configuration

Add the server to your Claude Code `mcp.json`:

```json
{
  "mcpServers": {
    "sqlpad": {
      "type": "stdio",
      "command": "node",
      "args": [
        "/absolute/path/to/sqlpad-mcp/dist/index.js",
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

## Tools

The full tool reference is generated at the end of the build.

## How SQL execution works

SQLPad executes SQL through asynchronous batches. Creating a batch returns immediately; each statement moves from `queued` to `started`, then to `finished` or `error`. Results are fetched separately for each statement and are unavailable until that statement is finished.

The `run_sql` tool absorbs the full protocol — create, poll, fetch, and return rows — so an agent makes one call. If polling reaches the configured timeout, the tool returns a `batchId` that the agent can resume with instead of hanging.

## Security

- `run_sql` executes arbitrary SQL, including DDL and DML, and is not sandboxed. `SQLPAD_ALLOW_WRITES` only gates mutation of SQLPad's own saved-query objects; it does not restrict SQL content. Use read-only database credentials on the SQLPad connection itself. That is the only real enforcement.
- SQLPad's `/api/service-tokens` endpoints are deliberately not exposed. A tool that mints credentials is a privilege-escalation primitive.
- Admin tools are off by default.
- The service token is redacted from all errors and logs. All logging goes to stderr because stdout is the JSON-RPC channel.
- Batches are scoped to the token's own user, so the server only ever sees its own query history.

## Contributing

Create a branch for your change. Before opening a pull request, run:

```sh
npx tsc --noEmit && npm run lint && npm test
```

## License

[MIT](./LICENSE)
