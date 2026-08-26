import type { StatementColumn } from '../types.js'

export interface FormattedRows {
  columns: { name: string; datatype: string | null }[]
  rows: Record<string, unknown>[]
  rowCount: number
  returnedRowCount: number
  truncated: boolean
}

function positionalName(index: number, usedNames: Set<string>): string {
  const baseName = `column_${index + 1}`
  let name = baseName
  let suffix = 2

  while (usedNames.has(name)) {
    name = `${baseName}_${suffix}`
    suffix += 1
  }

  usedNames.add(name)
  return name
}

export function formatRows(
  columns: StatementColumn[] | null,
  rawRows: unknown[][],
  maxRows: number,
): FormattedRows {
  const columnCount = rawRows.reduce(
    (largest, row) => Math.max(largest, row.length),
    columns?.length ?? 0,
  )
  const usedNames = new Set(columns?.map((column) => column.name) ?? [])
  const formattedColumns = Array.from({ length: columnCount }, (_, index) => {
    const column = columns?.[index]
    return column
      ? { name: column.name, datatype: column.datatype }
      : { name: positionalName(index, usedNames), datatype: null }
  })
  const rows = rawRows.slice(0, maxRows).map((rawRow) => {
    const row: Record<string, unknown> = {}
    for (const [index, column] of formattedColumns.entries()) {
      row[column.name] = rawRow[index]
    }
    return row
  })

  return {
    columns: formattedColumns,
    rows,
    rowCount: rawRows.length,
    returnedRowCount: rows.length,
    truncated: rawRows.length > maxRows,
  }
}
