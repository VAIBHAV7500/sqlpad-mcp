# Requirements

Implement the user-approved plan without scope expansion:

- Add statement-error diagnostics with schema-aware hints and one best-effort schema fetch per failing batch.
- Add the optional `hint` field to runtime and tool schemas.
- Preserve SQLPad error titles by composing them with known HTTP status messages.
- Document schema qualification for connections without a default database.
- Cover every listed success and failure scenario in Vitest.
- Pass lint, build, and the full test suite.
