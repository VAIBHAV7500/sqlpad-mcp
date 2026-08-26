import type { Statement } from '../types.js'

const MAX_SCHEMA_NAMES = 20

export interface StatementErrorDiagnosticContext {
  schemaNames: string[]
}

type StatementError = NonNullable<Statement['error']>

function schemaSuffix(names: string[]): string {
  const available = names.slice(0, MAX_SCHEMA_NAMES)
  if (available.length === 0) return ''

  const list = ` Available schemas: ${available.join(', ')}.`
  const more = names.length > MAX_SCHEMA_NAMES
    ? ' More schemas are available; use get_connection_schema to inspect them.'
    : ''
  return `${list}${more}`
}

export function diagnoseStatementError(
  error: StatementError,
  ctx: StatementErrorDiagnosticContext,
): string | undefined {
  const message = [error.title, error.detail].filter(Boolean).join(' ')
  const suffix = schemaSuffix(ctx.schemaNames)

  if (/no database selected/i.test(message)) {
    return `This connection has no default database; write table names as schema.table.${suffix}`
  }

  if (
    /table\s+['"`].+?['"`]\s+doesn't exist/i.test(message)
    || /relation\s+['"`].+?['"`]\s+does not exist/i.test(message)
    || /invalid object name/i.test(message)
  ) {
    return `The table may live in a schema that is not on the search path; qualify it as schema.table.${suffix}`
  }

  return undefined
}
