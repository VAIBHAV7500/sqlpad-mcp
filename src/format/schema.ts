import type {
  ConnectionSchema,
  ConnectionSchemaColumn,
  ConnectionSchemaTable,
} from '../types.js'

export type SchemaMode = 'summary' | 'full'

interface FullTable {
  name: string
  description?: string | null
  columns: ConnectionSchemaColumn[]
}

interface SummaryTable {
  name: string
  description?: string | null
  columnCount: number
}

interface FormattedSchema {
  name: string | null
  description?: string | null
  tables: Array<FullTable | SummaryTable>
}

interface NormalizedSchema {
  name: string | null
  description?: string | null
  tables: ConnectionSchemaTable[]
}

function normalize(raw: ConnectionSchema): NormalizedSchema[] {
  if (raw.schemas) return raw.schemas
  if (raw.tables) return [{ name: null, tables: raw.tables }]
  return []
}

function includesFilter(value: string | null, filter?: string): boolean {
  if (filter === undefined) return true
  return value?.toLocaleLowerCase().includes(filter.toLocaleLowerCase()) ?? false
}

function formatTable(table: ConnectionSchemaTable, mode: SchemaMode): FullTable | SummaryTable {
  const common = {
    name: table.name,
    ...(table.description === undefined ? {} : { description: table.description }),
  }

  if (mode === 'summary') {
    return { ...common, columnCount: table.columns.length }
  }

  return { ...common, columns: table.columns }
}

export function formatSchema(raw: ConnectionSchema, opts: {
  schemaFilter?: string
  tableFilter?: string
  mode: SchemaMode
  maxTables: number
}): { schemas: FormattedSchema[]; tableCount: number; truncated: boolean } {
  const filtered = normalize(raw)
    .filter((schema) => includesFilter(schema.name, opts.schemaFilter))
    .map((schema) => ({
      ...schema,
      tables: schema.tables.filter((table) => includesFilter(table.name, opts.tableFilter)),
    }))
    .filter((schema) => opts.tableFilter === undefined || schema.tables.length > 0)
  const tableCount = filtered.reduce((count, schema) => count + schema.tables.length, 0)
  let remaining = opts.maxTables
  const schemas = filtered.flatMap((schema): FormattedSchema[] => {
    const tables = schema.tables.slice(0, Math.max(remaining, 0))
    remaining -= tables.length
    if (tables.length === 0 && schema.tables.length > 0) return []

    return [{
      name: schema.name,
      ...(schema.description === undefined ? {} : { description: schema.description }),
      tables: tables.map((table) => formatTable(table, opts.mode)),
    }]
  })

  return {
    schemas,
    tableCount,
    truncated: tableCount > opts.maxTables,
  }
}
