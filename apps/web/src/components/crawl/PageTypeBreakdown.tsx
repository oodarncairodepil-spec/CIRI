import type { Page } from '@/api/types'

interface Props {
  pages: Page[]
}

export function PageTypeBreakdown({ pages }: Props) {
  const counts: Record<string, number> = {}
  for (const p of pages) {
    counts[p.pageType] = (counts[p.pageType] ?? 0) + 1
  }
  const total = pages.length
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1])

  if (entries.length === 0) return null

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Page types</h3>
      <div className="space-y-2">
        {entries.map(([type, count]) => (
          <div key={type} className="flex items-center gap-2">
            <span className="w-28 text-xs text-gray-600 capitalize">{type}</span>
            <div className="flex-1 h-2 rounded bg-gray-100 overflow-hidden">
              <div
                className="h-2 rounded bg-indigo-400"
                style={{ width: `${Math.round((count / total) * 100)}%` }}
              />
            </div>
            <span className="text-xs text-gray-500 w-8 text-right">{count}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
