# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-08-26

Initial public release.

### Added

- MCP server over stdio for SQLPad, configured by `SQLPAD_BASE_URL` and `SQLPAD_SERVICE_TOKEN`
  (or the `--base-url` / `--token` flags, which take precedence).
- **Execution tools:** `run_sql`, `get_batch`, `get_statement_results`, `cancel_batch`.
  `run_sql` absorbs SQLPad's asynchronous batch protocol — create, poll, fetch, return — into a
  single call, caps rows at `SQLPAD_MAX_ROWS` (default 500), reports truncation explicitly, and
  returns a resumable `batchId` on timeout instead of hanging.
- **Discovery tools:** `list_connections`, `get_connection_schema` (bounded, with schema and table
  filters), `list_drivers`.
- **Saved-query tools:** `list_queries`, `get_query`, `list_tags`, `list_query_history`, `format_sql`.
- **Saved-query write tools** behind `SQLPAD_ALLOW_WRITES`: `create_query`, `update_query`,
  `delete_query`.
- **Admin tools** behind `SQLPAD_ALLOW_ADMIN`: `get_connection`, `test_connection`, `list_users`.
- Startup preflight that reports the detected SQLPad version and exits on a `401`.
- Service-token redaction across all errors and logs; all logging on stderr, since stdout is the
  JSON-RPC channel.

### Security

- SQLPad's `/api/service-tokens` endpoints are deliberately not exposed — a tool that mints
  credentials is a privilege-escalation primitive.
- `run_sql` is not sandboxed and `SQLPAD_ALLOW_WRITES` does not restrict SQL content. Read-only
  enforcement must come from the SQLPad connection's own database credentials.
