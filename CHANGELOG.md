# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-08-26

First release published to npm. 0.1.0 was tagged but never published.

### Added

- `run_sql` now attaches an `error.hint` to a failed statement when the failure is one it can
  explain: "no database selected", or an unresolved table (`table '…' doesn't exist`,
  `relation '…' does not exist`, `invalid object name`). The hint suggests qualifying the name as
  `schema.table` and lists the connection's available schemas.
- The schema lookup backing that hint only runs on the failure path, is fetched at most once per
  `run_sql` call, and is bounded by a 5 s timeout. If it times out or fails, the statement error is
  returned unchanged rather than surfacing a secondary error.

### Fixed

- The version advertised in the MCP `serverInfo` handshake was hardcoded and had drifted from
  the package version. It is now read from `package.json` at startup.

### Changed

- `SqlPadError` messages now compose the generic status message with the API's `title` instead of
  discarding one of them, so HTTP failures explain what SQLPad actually rejected.

### Packaging

- Release metadata, `files` allowlist, `prepublishOnly` build guard, CI on Node 20 and 22, and a
  tag-triggered publish workflow using npm provenance.

## [0.1.0] - 2026-08-26

Initial implementation. Tagged locally but never published to npm.

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
