import { useState, useEffect } from 'react'
import { Spinner } from '@/components/common/Spinner'

interface Props {
  title: string
  summary?: React.ReactNode
  badge?: React.ReactNode
  defaultCollapsed?: boolean
  forceOpen?: boolean
  accent?: string
  onRetake?: () => void
  retakeLabel?: string
  retakeLoading?: boolean
  children: React.ReactNode
}

export function CollapsibleCard({
  title, summary, badge, defaultCollapsed = true, forceOpen,
  accent = 'bg-gray-300', onRetake, retakeLabel = 'Re-run', retakeLoading = false,
  children,
}: Props) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  useEffect(() => {
    if (forceOpen) setCollapsed(false)
  }, [forceOpen])

  return (
    <div className="rounded-lg border border-gray-200 bg-white overflow-hidden flex">
      {/* Left accent bar */}
      <div className={`w-1 shrink-0 ${accent}`} />
      <div className="flex-1 min-w-0">
        <button
          onClick={() => setCollapsed(c => !c)}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-sm font-semibold text-gray-800 shrink-0">{title}</span>
            {summary && <span className="text-xs text-gray-400 truncate">{summary}</span>}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {badge}
            <svg
              className={`h-4 w-4 text-gray-400 transition-transform duration-150 ${collapsed ? '' : 'rotate-180'}`}
              fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>

        {!collapsed && (
          <div className="border-t border-gray-100">
            {children}

            {/* Retake footer */}
            {onRetake && (
              <div className="flex justify-end px-4 py-2.5 border-t border-gray-100 bg-gray-50/60">
                <button
                  onClick={onRetake}
                  disabled={retakeLoading}
                  className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {retakeLoading ? (
                    <Spinner size="sm" />
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  )}
                  {retakeLabel}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
