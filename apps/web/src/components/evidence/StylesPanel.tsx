import { useState } from 'react'

interface StyleEntry {
  computed?: Record<string, string>
  [key: string]: unknown
}

interface Props {
  styles: Record<string, StyleEntry>
}

export function StylesPanel({ styles }: Props) {
  const [active, setActive] = useState<string | null>(null)
  const selectors = Object.keys(styles)

  if (selectors.length === 0) {
    return <p className="text-sm text-gray-500">No style data available.</p>
  }

  return (
    <div className="flex gap-4 overflow-auto max-h-[60vh]">
      <ul className="w-48 shrink-0 border-r border-gray-200 pr-2 space-y-1">
        {selectors.map((sel) => (
          <li key={sel}>
            <button
              onClick={() => setActive(sel)}
              className={`w-full text-left truncate text-xs px-2 py-1 rounded ${
                active === sel ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-gray-600 hover:bg-gray-50'
              }`}
              title={sel}
            >
              {sel}
            </button>
          </li>
        ))}
      </ul>

      <div className="flex-1 overflow-auto">
        {active && styles[active]?.computed ? (
          <table className="min-w-full text-xs">
            <tbody className="divide-y divide-gray-100">
              {Object.entries(styles[active].computed ?? {}).map(([prop, val]) => (
                <tr key={prop} className="hover:bg-gray-50">
                  <td className="py-1 pr-4 text-gray-500 font-mono">{prop}</td>
                  <td className="py-1 text-gray-800 font-mono">{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-sm text-gray-400">Select a selector to view styles.</p>
        )}
      </div>
    </div>
  )
}
