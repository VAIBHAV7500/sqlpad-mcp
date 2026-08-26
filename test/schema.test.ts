import { describe, expect, it } from 'vitest'
import { formatSchema } from '../src/format/schema.js'
import type { ConnectionSchema } from '../src/types.js'

const schemaShape: ConnectionSchema = {
  schemas: [
    {
      name: 'Public',
      description: 'Application data',
      tables: [
        {
          name: 'Users',
          description: 'People',
          columns: [
            { name: 'id', dataType: 'integer' },
            { name: 'email', description: 'Login', dataType: 'varchar' },
          ],
        },
        { name: 'AuditLog', columns: [{ name: 'at', dataType: 'timestamp' }] },
      ],
    },
    {
      name: 'Analytics',
      tables: [{ name: 'Events', columns: [{ name: 'payload', dataType: 'json' }] }],
    },
  ],
}

describe('formatSchema', () => {
  it('formats the schemas shape in full mode', () => {
    const result = formatSchema(schemaShape, { mode: 'full', maxTables: 10 })

    expect(result.tableCount).toBe(3)
    expect(result.truncated).toBe(false)
    expect(result.schemas[0]?.name).toBe('Public')
    expect(result.schemas[0]?.tables[0]).toMatchObject({
      name: 'Users',
      columns: [
        { name: 'id', dataType: 'integer' },
        { name: 'email', description: 'Login', dataType: 'varchar' },
      ],
    })
  })

  it('normalizes the schemaless tables shape', () => {
    const result = formatSchema({
      tables: [{ name: 'Things', columns: [{ name: 'value', dataType: 'text' }] }],
    }, { mode: 'full', maxTables: 10 })

    expect(result).toEqual({
      schemas: [{
        name: null,
        tables: [{
          name: 'Things',
          columns: [{ name: 'value', dataType: 'text' }],
        }],
      }],
      tableCount: 1,
      truncated: false,
    })
  })

  it('normalizes an empty schema response', () => {
    expect(formatSchema({}, { mode: 'full', maxTables: 10 })).toEqual({
      schemas: [],
      tableCount: 0,
      truncated: false,
    })
  })

  it('filters schemas with a case-insensitive substring match', () => {
    const result = formatSchema(schemaShape, {
      schemaFilter: 'NALY',
      mode: 'full',
      maxTables: 10,
    })

    expect(result.schemas.map((schema) => schema.name)).toEqual(['Analytics'])
    expect(result.tableCount).toBe(1)
  })

  it('filters tables with a case-insensitive substring match', () => {
    const result = formatSchema(schemaShape, {
      tableFilter: 'user',
      mode: 'full',
      maxTables: 10,
    })

    expect(result.schemas).toHaveLength(1)
    expect(result.schemas[0]?.tables.map((table) => table.name)).toEqual(['Users'])
    expect(result.tableCount).toBe(1)
  })

  it('omits column detail in summary mode while reporting column counts', () => {
    const result = formatSchema(schemaShape, { mode: 'summary', maxTables: 10 })
    const firstTable = result.schemas[0]?.tables[0]

    expect(firstTable).toMatchObject({ name: 'Users', columnCount: 2 })
    expect(firstTable).not.toHaveProperty('columns')
  })

  it('caps tables globally, reports the total matching count, and marks truncation', () => {
    const result = formatSchema(schemaShape, { mode: 'summary', maxTables: 2 })

    expect(result.schemas.flatMap((schema) => schema.tables)).toHaveLength(2)
    expect(result.tableCount).toBe(3)
    expect(result.truncated).toBe(true)
  })
})
