import { useState } from 'react'
import { GapBadge } from './GapBadge'
import type { PlugoMapping } from '@/api/types'

interface Props {
  mappings: PlugoMapping[]
}

export function GapReportTable({ mappings }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)

  const sorted = [...mappings].sort((a, b) => {
    if (a.isGap !== b.isGap) return a.isGap ? -1 : 1
    return a.componentType.localeCompare(b.componentType)
  })

  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 border-b border-gray-200">
          <tr>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Component</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Plugo Endpoint</th>
            <th className="px-4 py-3 text-left font-medium text-gray-600">Render Hint / Gap Reason</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {sorted.map((m) => {
            const isExpanded = expanded === m.componentType
            const hint = m.isGap ? m.gapReason ?? '' : m.renderHint
            const truncated = hint.length > 80 && !isExpanded ? hint.slice(0, 80) + '…' : hint

            return (
              <tr key={m.componentType} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-mono text-xs text-gray-800">{m.componentType}</td>
                <td className="px-4 py-3"><GapBadge isGap={m.isGap} /></td>
                <td className="px-4 py-3 text-xs text-gray-600 font-mono">
                  {m.plugoEndpoint ?? '—'}
                </td>
                <td className="px-4 py-3 text-xs text-gray-600 max-w-sm">
                  {truncated}
                  {hint.length > 80 && (
                    <button
                      onClick={() => setExpanded(isExpanded ? null : m.componentType)}
                      className="ml-1 text-indigo-600 hover:underline"
                    >
                      {isExpanded ? 'less' : 'more'}
                    </button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
