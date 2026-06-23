import { type ReactNode, useState } from 'react'

interface Column<T> {
  key: string
  header: string
  sortable?: boolean
  numeric?: boolean
  render: (row: T) => ReactNode
}

interface TableProps<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  onRowClick?: (row: T) => void
  getRowKey: (row: T) => string
}

function SkeletonRow({ cols }: { cols: number }) {
  return (
    <tr>
      {Array.from({ length: cols }, (_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 rounded bg-[var(--bg-overlay)] animate-pulse" />
        </td>
      ))}
    </tr>
  )
}

export default function Table<T>({
  columns,
  data,
  loading = false,
  onRowClick,
  getRowKey
}: TableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  function handleSort(key: string) {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedData = sortKey
    ? [...data].sort((a, b) => {
        const col = columns.find((c) => c.key === sortKey)
        if (!col) return 0
        const aVal = String(col.render(a))
        const bVal = String(col.render(b))
        const cmp = aVal.localeCompare(bVal, undefined, { numeric: true })
        return sortDir === 'asc' ? cmp : -cmp
      })
    : data

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
      <table className="w-full text-sm text-left">
        <thead>
          <tr className="border-b border-[var(--border)] bg-[var(--bg-raised)]">
            {columns.map((col) => (
              <th
                key={col.key}
                className={`px-4 py-3 font-medium text-[var(--text-secondary)] ${
                  col.sortable ? 'cursor-pointer select-none hover:text-[var(--text-primary)]' : ''
                } ${col.numeric ? 'tabular-nums text-right' : ''}`}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <span className="inline-flex items-center gap-1">
                  {col.header}
                  {col.sortable && sortKey === col.key && (
                    <span aria-label={sortDir === 'asc' ? 'sorted ascending' : 'sorted descending'}>
                      {sortDir === 'asc' ? '↑' : '↓'}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading &&
            Array.from({ length: 5 }, (_, i) => <SkeletonRow key={i} cols={columns.length} />)}
          {!loading &&
            sortedData.map((row) => (
              <tr
                key={getRowKey(row)}
                className={`border-b border-[var(--border)] last:border-0 ${
                  onRowClick ? 'cursor-pointer hover:bg-[var(--bg-hover)] transition-colors' : ''
                }`}
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={`px-4 py-3 text-[var(--text-primary)] ${
                      col.numeric ? 'tabular-nums text-right' : ''
                    }`}
                  >
                    {col.render(row)}
                  </td>
                ))}
              </tr>
            ))}
        </tbody>
      </table>
    </div>
  )
}
