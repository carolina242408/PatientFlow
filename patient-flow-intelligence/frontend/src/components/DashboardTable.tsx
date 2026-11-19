import type { Key, ReactNode } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/Table'

export interface DashboardTableColumn<Row> {
  key: string
  header: ReactNode
  renderCell: (row: Row) => ReactNode
  align?: 'left' | 'center'
  rowHeader?: boolean
}

interface DashboardTableProps<Row> {
  columns: readonly DashboardTableColumn<Row>[]
  rows: readonly Row[]
  getRowKey: (row: Row) => Key
  tableClassName: string
  containerClassName?: string
  expanded?: boolean
}

function DashboardTable<Row>({
  columns,
  rows,
  getRowKey,
  tableClassName,
  expanded = false,
  containerClassName,
}: DashboardTableProps<Row>) {
  return (
    <Table className={tableClassName} containerClassName={containerClassName}>
      <TableHeader>
        <TableRow
          className={`bg-gray-50 ${
            expanded ? 'text-sm text-gray-500' : 'text-xs text-gray-400'
          } font-medium uppercase tracking-wide hover:bg-transparent`}
        >
          {columns.map((column, index) => (
            <TableHead
              key={column.key}
              scope="col"
              className={`sticky top-0 z-10 bg-gray-50 ${expanded ? 'px-6 py-5' : ` py-4 ${index === 0 ? 'px-6' : 'px-4'}`} ${
                column.align === 'center' ? 'text-center' : 'text-left'
              }`}
            >
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={getRowKey(row)}
            className="border-t border-b border-gray-100 text-gray-600 hover:bg-transparent"
          >
            {columns.map((column, index) => {
              const className = `${
                expanded
                  ? 'px-6 py-5'
                  : `${index === 0 ? 'px-6' : 'px-4'} py-3.5`
              } ${
                column.align === 'center' ? 'text-center' : 'text-left'
              } ${
                column.rowHeader ? 'font-medium text-slate-900' : ''
              }`

              return column.rowHeader ? (
                <TableHead
                  key={column.key}
                  scope="row"
                  className={className}
                >
                  {column.renderCell(row)}
                </TableHead>
              ) : (
                <TableCell key={column.key} className={className}>
                  {column.renderCell(row)}
                </TableCell>
              )
            })}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

export default DashboardTable
