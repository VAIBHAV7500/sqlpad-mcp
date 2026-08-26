import { describe, expect, it } from 'vitest'
import { formatRows } from '../src/format/rows.js'
import type { StatementColumn } from '../src/types.js'

function column(name: string, datatype: StatementColumn['datatype']): StatementColumn {
  return { name, datatype, min: null, max: null, maxValueLength: 0, maxLineLength: 0 }
}

describe('formatRows', () => {
  it('zips positional values against statement column names', () => {
    const result = formatRows(
      [column('id', 'number'), column('name', 'string')],
      [[1, 'Ada'], [2, 'Grace']],
      10,
    )

    expect(result).toEqual({
      columns: [
        { name: 'id', datatype: 'number' },
        { name: 'name', datatype: 'string' },
      ],
      rows: [{ id: 1, name: 'Ada' }, { id: 2, name: 'Grace' }],
      rowCount: 2,
      returnedRowCount: 2,
      truncated: false,
    })
  })

  it('handles zero rows', () => {
    expect(formatRows([column('id', 'number')], [], 10)).toMatchObject({
      rows: [],
      rowCount: 0,
      returnedRowCount: 0,
      truncated: false,
    })
  })

  it('caps returned rows and reports the uncapped row count', () => {
    const result = formatRows([column('id', 'number')], [[1], [2], [3]], 2)

    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }])
    expect(result.rowCount).toBe(3)
    expect(result.returnedRowCount).toBe(2)
    expect(result.truncated).toBe(true)
  })

  it('represents missing cells in a ragged row without shifting columns', () => {
    const result = formatRows(
      [column('id', 'number'), column('name', 'string')],
      [[1]],
      10,
    )

    expect(result.rows[0]).toEqual({ id: 1, name: undefined })
  })

  it('adds positional metadata for values beyond the supplied columns', () => {
    const result = formatRows([column('id', 'number')], [[1, 'extra']], 10)

    expect(result.columns).toEqual([
      { name: 'id', datatype: 'number' },
      { name: 'column_2', datatype: null },
    ])
    expect(result.rows).toEqual([{ id: 1, column_2: 'extra' }])
  })

  it('falls back to positional keys when columns are null', () => {
    const result = formatRows(null, [['Ada', 37]], 10)

    expect(result.columns).toEqual([
      { name: 'column_1', datatype: null },
      { name: 'column_2', datatype: null },
    ])
    expect(result.rows).toEqual([{ column_1: 'Ada', column_2: 37 }])
  })

  it('preserves null, Date, and object cell values', () => {
    const date = new Date('2026-01-02T03:04:05.000Z')
    const object = { nested: true }
    const result = formatRows(
      [column('nullable', 'string'), column('created', 'datetime'), column('payload', 'object')],
      [[null, date, object]],
      10,
    )

    expect(result.rows[0]).toEqual({ nullable: null, created: date, payload: object })
    expect(result.rows[0]?.created).toBe(date)
    expect(result.rows[0]?.payload).toBe(object)
  })
})
